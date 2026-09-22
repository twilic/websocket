import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MESSAGE_LIMIT,
  TWILIC_CONTENT_TYPE,
  TwilicMessageLimitError,
  TwilicUnsupportedFrameError,
  attachTwilicWebSocket,
  createTwilicWebSocket,
  parseTwilicMessage,
  twilicSend,
} from "../dist/index.js";

test("TWILIC_CONTENT_TYPE is application/vnd.twilic", () => {
  assert.equal(TWILIC_CONTENT_TYPE, "application/vnd.twilic");
});

test("DEFAULT_MESSAGE_LIMIT is 1 MiB", () => {
  assert.equal(DEFAULT_MESSAGE_LIMIT, 1_048_576);
});

test("named exports are functions and error classes", () => {
  assert.equal(typeof createTwilicWebSocket, "function");
  assert.equal(typeof twilicSend, "function");
  assert.equal(typeof parseTwilicMessage, "function");
  assert.equal(typeof attachTwilicWebSocket, "function");
  assert.equal(typeof TwilicMessageLimitError, "function");
  assert.equal(typeof TwilicUnsupportedFrameError, "function");
});

test("createTwilicWebSocket returns send, parseMessage, and attach", () => {
  const twilic = createTwilicWebSocket();
  assert.equal(typeof twilic.send, "function");
  assert.equal(typeof twilic.parseMessage, "function");
  assert.equal(typeof twilic.attach, "function");
});
