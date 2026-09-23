import assert from "node:assert/strict";
import { before, test } from "node:test";

import WebSocket from "ws";

import { createTwilicWebSocket } from "../dist/index.js";
import {
  createEchoWebSocketServer,
  onceMessage,
  onceOpen,
} from "./helpers.mjs";

const STATE_PATCH = 0x0a;

before(async () => {
  const { init } = await import("@twilic/core");
  await init();
});

function frameBytes(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  throw new TypeError("unexpected websocket message");
}

function onceClose(socket) {
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
  });
}

function createInbox() {
  const values = [];
  const errors = [];
  const waiters = new Set();

  const notify = () => {
    for (const waiter of waiters) {
      waiter();
    }
  };

  return {
    values,
    errors,
    push(value) {
      values.push(value);
      notify();
    },
    fail(error) {
      errors.push(error);
      notify();
    },
    untilValues(count) {
      if (values.length >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(
            new Error(
              `timed out waiting for ${count} decoded values, saw ${values.length}`
            )
          );
        }, 1000);
        const check = () => {
          if (values.length >= count) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve();
          }
        };
        waiters.add(check);
      });
    },
    untilErrors(count) {
      if (errors.length >= count) {
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(
            new Error(
              `timed out waiting for ${count} decode errors, saw ${errors.length}`
            )
          );
        }, 1000);
        const check = () => {
          if (errors.length >= count) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve();
          }
        };
        waiters.add(check);
      });
    },
  };
}

async function sendFrame(twilic, socket, value) {
  const echoed = onceMessage(socket);
  twilic.send(value);
  const { data, isBinary } = await echoed;
  assert.equal(isBinary, true);
  return frameBytes(data);
}

test("stateful full frame is followed by a patch", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);
    const inbox = createInbox();
    const twilic = createTwilicWebSocket(socket, {
      stateful: true,
      onError(error) {
        inbox.fail(error);
      },
    });
    const detach = twilic.onMessage((value) => inbox.push(value));

    const base = { x: 100n, y: 200n, hp: 100n };
    const next = { x: 101n, y: 200n, hp: 100n };

    const full = await sendFrame(twilic, socket, base);
    assert.notEqual(full[0], STATE_PATCH);
    await inbox.untilValues(1);

    const patch = await sendFrame(twilic, socket, next);
    assert.equal(patch[0], STATE_PATCH);
    assert.ok(patch.byteLength < full.byteLength);
    await inbox.untilValues(2);

    assert.deepEqual(inbox.values, [base, next]);
    assert.deepEqual(inbox.errors, []);

    detach();
    socket.close();
  } finally {
    await server.close();
  }
});

test("stateful session applies several patches in order", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);
    const inbox = createInbox();
    const twilic = createTwilicWebSocket(socket, {
      stateful: true,
      onError(error) {
        inbox.fail(error);
      },
    });
    const detach = twilic.onMessage((value) => inbox.push(value));

    const frames = [
      { x: 100n, y: 200n, hp: 100n },
      { x: 101n, y: 200n, hp: 100n },
      { x: 102n, y: 200n, hp: 100n },
      { x: 102n, y: 201n, hp: 100n },
    ];

    const full = await sendFrame(twilic, socket, frames[0]);
    assert.notEqual(full[0], STATE_PATCH);
    await inbox.untilValues(1);

    for (let index = 1; index < frames.length; index += 1) {
      const patch = await sendFrame(twilic, socket, frames[index]);
      assert.equal(patch[0], STATE_PATCH);
      assert.ok(patch.byteLength < full.byteLength);
      await inbox.untilValues(index + 1);
    }

    assert.deepEqual(inbox.values, frames);
    assert.deepEqual(inbox.errors, []);

    detach();
    socket.close();
  } finally {
    await server.close();
  }
});

test("stateful reconnect opens a new session", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const first = new WebSocket(server.url);
    await onceOpen(first);
    const firstInbox = createInbox();
    const firstTwilic = createTwilicWebSocket(first, { stateful: true });
    const detachFirst = firstTwilic.onMessage((value) =>
      firstInbox.push(value)
    );

    const base = { x: 1n, y: 2n, hp: 3n };
    const next = { x: 4n, y: 2n, hp: 3n };

    const full = await sendFrame(firstTwilic, first, base);
    assert.notEqual(full[0], STATE_PATCH);
    await firstInbox.untilValues(1);
    const patch = await sendFrame(firstTwilic, first, next);
    assert.equal(patch[0], STATE_PATCH);
    await firstInbox.untilValues(2);
    assert.deepEqual(firstInbox.values, [base, next]);

    const closed = onceClose(first);
    first.close();
    await closed;
    detachFirst();

    const second = new WebSocket(server.url);
    await onceOpen(second);
    const secondInbox = createInbox();
    const secondTwilic = createTwilicWebSocket(second, {
      stateful: true,
      onError(error) {
        secondInbox.fail(error);
      },
    });
    const detachSecond = secondTwilic.onMessage((value) =>
      secondInbox.push(value)
    );

    await assert.rejects(
      () => secondTwilic.parseMessage(patch, { isBinary: true }),
      /unknown reference|previous_message|stateless retry|invalid data/i
    );

    const freshBase = { x: 10n, y: 20n, hp: 30n };
    const freshNext = { x: 11n, y: 20n, hp: 30n };
    const freshFull = await sendFrame(secondTwilic, second, freshBase);
    assert.notEqual(freshFull[0], STATE_PATCH);
    await secondInbox.untilValues(1);
    const freshPatch = await sendFrame(secondTwilic, second, freshNext);
    assert.equal(freshPatch[0], STATE_PATCH);
    await secondInbox.untilValues(2);

    assert.deepEqual(secondInbox.values, [freshBase, freshNext]);
    assert.deepEqual(secondInbox.errors, []);

    detachSecond();
    second.close();
  } finally {
    await server.close();
  }
});

test("stateful decode failure does not break decoder state", async () => {
  const server = await createEchoWebSocketServer();
  try {
    const socket = new WebSocket(server.url);
    await onceOpen(socket);
    const inbox = createInbox();
    const twilic = createTwilicWebSocket(socket, {
      stateful: true,
      onError(error) {
        inbox.fail(error);
      },
    });
    const detach = twilic.onMessage((value) => inbox.push(value));

    const base = { x: 100n, y: 200n, hp: 100n };
    const first = { x: 101n, y: 200n, hp: 100n };
    const second = { x: 102n, y: 200n, hp: 100n };

    await sendFrame(twilic, socket, base);
    await inbox.untilValues(1);
    const patch = await sendFrame(twilic, socket, first);
    assert.equal(patch[0], STATE_PATCH);
    await inbox.untilValues(2);

    const corrupt = Buffer.from([STATE_PATCH, 0xff, 0x01]);
    for (const expectedErrors of [1, 2]) {
      const echoed = onceMessage(socket);
      socket.send(corrupt, { binary: true });
      const { data, isBinary } = await echoed;
      assert.equal(isBinary, true);
      assert.deepEqual(frameBytes(data), corrupt);
      await inbox.untilErrors(expectedErrors);
    }

    assert.equal(inbox.values.length, 2);
    assert.equal(inbox.errors.length, 2);

    const next = await sendFrame(twilic, socket, second);
    assert.equal(next[0], STATE_PATCH);
    await inbox.untilValues(3);

    assert.deepEqual(inbox.values, [base, first, second]);
    assert.equal(inbox.errors.length, 2);

    detach();
    socket.close();
  } finally {
    await server.close();
  }
});
