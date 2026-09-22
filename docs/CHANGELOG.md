# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `createTwilicWebSocket({ stateful: true, session? })` for the Twilic WebSocket Stateful Profile: per-socket outbound `SessionEncoder` and inbound `SessionDecoder`, with `send()` always using `encodePatch()`.
- Stateful `parseMessage` requires `options.socket` to select the inbound decoder.

### Changed

- Peer and dev dependency on `@twilic/core` is `^3.2.0` (`createSessionDecoder`). npm still serves `3.1.0`, so the lockfile resolves that range to the local package until `3.2.0` is published. Refresh the lockfile after publish.

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
