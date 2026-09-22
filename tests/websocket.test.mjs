import assert from "node:assert/strict";
import { test } from "node:test";

import WebSocket from "ws";

import {
  TwilicUnsupportedFrameError,
  attachTwilicWebSocket,
  createTwilicWebSocket,
  parseTwilicMessage,
  twilicSend,
} from "../dist/index.js";
import {
  createEchoWebSocketServer,
  createJsonCodec,
  createTrackingCodec,
  onceMessage,
  onceOpen,
} from "./helpers.mjs";

test("twilicSend round-trips through echo server with global WebSocket", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const socket = new globalThis.WebSocket(server.url);
    await onceOpen(socket);

    const payload = { id: 42n, name: "alice", tags: ["a", "b"] };
    const messagePromise = onceMessage(socket);
    twilicSend(socket, payload);

    const { data } = await messagePromise;
    const decoded = await parseTwilicMessage(data);
    assert.equal(decoded.id, 42n);
    assert.equal(decoded.name, "alice");
    assert.deepEqual(decoded.tags, ["a", "b"]);

    socket.close();
  } finally {
    await server.close();
  }
});

test("twilicSend round-trips through echo server with ws client", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);

    const payload = { ok: true, value: 7n };
    const messagePromise = onceMessage(socket);
    twilicSend(socket, payload);

    const { data, isBinary } = await messagePromise;
    assert.equal(isBinary, true);
    const decoded = await parseTwilicMessage(data, { isBinary });
    assert.equal(decoded.ok, true);
    assert.equal(decoded.value, 7n);

    socket.close();
  } finally {
    await server.close();
  }
});

test("parseTwilicMessage rejects text frames by default", async () => {
  await assert.rejects(
    () => parseTwilicMessage("not-binary"),
    (error) => {
      assert.ok(error instanceof TwilicUnsupportedFrameError);
      return true;
    }
  );
});

test("parseTwilicMessage allows text when requireBinary is false", async () => {
  const codec = createJsonCodec();
  const twilic = createTwilicWebSocket(codec);
  const decoded = await twilic.parseMessage(JSON.stringify({ ok: true }), {
    requireBinary: false,
  });
  assert.deepEqual(decoded, { ok: true });
});

test("createTwilicWebSocket uses injected codec", async () => {
  const codec = createTrackingCodec();
  const twilic = createTwilicWebSocket(codec);
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);

    const messagePromise = onceMessage(socket);
    twilic.send(socket, { tracked: true });
    const { data, isBinary } = await messagePromise;
    await twilic.parseMessage(data, { isBinary });

    assert.equal(codec.stats.encodeCalls, 1);
    assert.equal(codec.stats.decodeCalls, 1);
    assert.deepEqual(codec.stats.lastEncoded, { tracked: true });

    socket.close();
  } finally {
    await server.close();
  }
});

test("attachTwilicWebSocket delivers decoded values and supports detach", async () => {
  const codec = createJsonCodec();
  const twilic = createTwilicWebSocket(codec);
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);

    const received = [];
    const detach = twilic.attach(socket, (value) => {
      received.push(value);
    });

    const first = onceMessage(socket);
    twilic.send(socket, { n: 1 });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(received, [{ n: 1 }]);

    detach();

    const second = onceMessage(socket);
    twilic.send(socket, { n: 2 });
    await second;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(received, [{ n: 1 }]);

    socket.close();
  } finally {
    await server.close();
  }
});

test("attachTwilicWebSocket routes decode errors to onError", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);

    let seenError = null;
    const detach = attachTwilicWebSocket(
      socket,
      () => {
        throw new Error("listener should not run");
      },
      {
        onError(error) {
          seenError = error;
        },
      }
    );

    const messagePromise = onceMessage(socket);
    socket.send("plain-text");
    await messagePromise;
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(seenError instanceof TwilicUnsupportedFrameError);
    detach();
    socket.close();
  } finally {
    await server.close();
  }
});

test("stateful createTwilicWebSocket round-trips full then patch", async () => {
  const { init } = await import("@twilic/core");
  await init();

  const twilic = createTwilicWebSocket({ stateful: true });
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);

    const received = [];
    const detach = twilic.attach(socket, (value) => {
      received.push(value);
    });

    const base = { x: 100n, y: 200n, hp: 100n };
    const next = { x: 101n, y: 200n, hp: 100n };

    const firstEcho = onceMessage(socket);
    twilic.send(socket, base);
    const { data: firstData, isBinary: firstBinary } = await firstEcho;
    assert.equal(firstBinary, true);
    const firstBytes = Buffer.isBuffer(firstData)
      ? firstData
      : Buffer.from(firstData);
    assert.notEqual(firstBytes[0], 0x0a);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(received, [base]);

    const secondEcho = onceMessage(socket);
    twilic.send(socket, next);
    const { data: secondData, isBinary: secondBinary } = await secondEcho;
    assert.equal(secondBinary, true);
    const secondBytes = Buffer.isBuffer(secondData)
      ? secondData
      : Buffer.from(secondData);
    assert.equal(secondBytes[0], 0x0a);

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(received, [base, next]);

    detach();
    socket.close();
  } finally {
    await server.close();
  }
});

test("stateful sessions are per-socket and do not inherit across reconnect", async () => {
  const { init } = await import("@twilic/core");
  await init();

  const twilic = createTwilicWebSocket({ stateful: true });
  const server = await createEchoWebSocketServer();
  try {
    const first = new WebSocket(server.url);
    await onceOpen(first);

    const base = { x: 1n, y: 2n, hp: 3n };
    const next = { x: 4n, y: 2n, hp: 3n };

    const firstEcho = onceMessage(first);
    twilic.send(first, base);
    const { data: fullData } = await firstEcho;
    await twilic.parseMessage(fullData, { socket: first, isBinary: true });

    const patchEcho = onceMessage(first);
    twilic.send(first, next);
    const { data: patchData } = await patchEcho;
    const patchBytes = Buffer.isBuffer(patchData)
      ? patchData
      : Buffer.from(patchData);
    assert.equal(patchBytes[0], 0x0a);

    first.close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = new WebSocket(server.url);
    await onceOpen(second);

    await assert.rejects(
      () =>
        twilic.parseMessage(patchData, {
          socket: second,
          isBinary: true,
        }),
      /unknown reference|previous_message|stateless retry|invalid data/i
    );

    second.close();
  } finally {
    await server.close();
  }
});

test("stateful parseMessage requires options.socket", async () => {
  const twilic = createTwilicWebSocket({ stateful: true });
  await assert.rejects(
    () => twilic.parseMessage(new Uint8Array([0x00])),
    /options\.socket/
  );
});

test("createTwilicWebSocket rejects stateful with custom codec", () => {
  assert.throws(
    () =>
      createTwilicWebSocket({
        stateful: true,
        encode: () => new Uint8Array(),
        decode: () => null,
      }),
    /cannot combine stateful/
  );
});
