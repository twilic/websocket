# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-09-23

### Changed

- **Breaking:** `createTwilicWebSocket(socket, options?)` binds one WebSocket. `send(value)` returns the encoded bytes, and `onMessage(listener)` decodes inbound frames for that socket. Browser `WebSocket` and `ws` are accepted directly.
- Stateful mode keeps the encoder and decoder on the connection. Closing the socket ends the session. The next connection starts with a full frame.

### Added

- Stateful end-to-end coverage for full-then-patch, multiple patches, reconnect as a new session, and decoder state remaining intact after a decode failure.

## [0.2.0] - 2026-09-22

### Added

- `createTwilicWebSocket({ stateful: true, session? })` for the Twilic WebSocket Stateful Profile: per-socket outbound `SessionEncoder` and inbound `SessionDecoder`, with `send()` always using `encodePatch()`.
- Stateful `parseMessage` requires `options.socket` to select the inbound decoder.

### Changed

- Peer and dev dependency on `@twilic/core` is `^3.2.0` (`createSessionDecoder`).

## [0.1.0] - 2026-09-22

Initial public release of `@twilic/websocket`.

### Added

- `TWILIC_CONTENT_TYPE` (`application/vnd.twilic`) constant.
- `DEFAULT_MESSAGE_LIMIT` (1 MiB) for inbound frame size checks.
- `twilicSend(socket, value)` helper to send Twilic-encoded binary frames.
- `parseTwilicMessage(data, options?)` helper to decode inbound frames.
- `attachTwilicWebSocket(socket, listener, options?)` helper that returns a detach function.
- `createTwilicWebSocket(codec?)` factory for injectable encode/decode.
- `TwilicMessageLimitError` and `TwilicUnsupportedFrameError`.
- Node integration tests with `ws` echo server and global `WebSocket`.
- CI workflows for format, lint, typecheck, tests, commitlint, and PR body validation.
