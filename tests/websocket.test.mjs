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
