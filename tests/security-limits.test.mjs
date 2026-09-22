import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MESSAGE_LIMIT,
  TwilicMessageLimitError,
  createTwilicWebSocket,
  parseTwilicMessage,
} from "../dist/index.js";

test("message limits reject before decoding and accept exact boundary", async () => {
  let decodeCalls = 0;
  const twilic = createTwilicWebSocket({
    encode: () => new Uint8Array(),
    decode: (bytes) => {
      decodeCalls += 1;
      return bytes.byteLength;
    },
  });

  await assert.rejects(
    () => twilic.parseMessage(new Uint8Array(5), { limit: 4 }),
    (error) => {
      assert.ok(error instanceof TwilicMessageLimitError);
      return true;
    }
  );
  assert.equal(decodeCalls, 0);

  const accepted = await twilic.parseMessage(new Uint8Array(4), { limit: 4 });
  assert.equal(accepted, 4);
  assert.equal(decodeCalls, 1);

  await assert.rejects(
    () =>
      parseTwilicMessage(new Uint8Array(DEFAULT_MESSAGE_LIMIT + 1), {
        requireBinary: true,
      }),
    TwilicMessageLimitError
  );
});

test("invalid message limits fail at configuration", async () => {
  for (const limit of [-1, 1.5, Infinity, NaN]) {
    await assert.rejects(
      () => createTwilicWebSocket().parseMessage(new Uint8Array(), { limit }),
      RangeError
    );
    assert.throws(
      () => createTwilicWebSocket().attach({ send() {} }, () => {}, { limit }),
      RangeError
    );
  }
});
