# @twilic/websocket

WebSocket helpers for Twilic binary frames.

## Install

```bash
bun add @twilic/websocket @twilic/core
```

## Usage

```ts
import { init } from "@twilic/core";
import { createTwilicWebSocket } from "@twilic/websocket";

await init();

const twilic = createTwilicWebSocket(new WebSocket("ws://localhost:8788"));

twilic.onMessage((value) => {
  console.log(value);
});

twilic.send({ id: 1n, name: "alice" });
```

One WebSocket message equals one Twilic frame. Send binary frames only (`opcode 0x2`).

Pass a browser `WebSocket` or a [`ws`](https://github.com/websockets/ws) socket directly. In the browser, call `init({ prefer: "wasm" })` from `@twilic/core` before using these helpers.

## Stateful profile

One call binds one connection. That connection keeps its own outbound encoder and inbound decoder, and `send()` uses `encodePatch()`:

```ts
import { init } from "@twilic/core";
import { createTwilicWebSocket } from "@twilic/websocket";

await init();

const twilic = createTwilicWebSocket(socket, {
  stateful: true,
  session: { maxBaseSnapshots: 8 },
});

twilic.onMessage((value) => {
  console.log(value);
});

twilic.send({ x: 100, y: 200, hp: 100 });
twilic.send({ x: 101, y: 200, hp: 100 });
```

Closing the socket ends the session. A new socket needs a new `createTwilicWebSocket()` call, and its first `send()` is a full frame.

## API

- `TWILIC_CONTENT_TYPE`
- `DEFAULT_MESSAGE_LIMIT`
- `createTwilicWebSocket(socket, options?)`
- `twilicSend(socket, value)`
- `parseTwilicMessage(data, options?)`
- `attachTwilicWebSocket(socket, listener, options?)`
- `TwilicMessageLimitError`
- `TwilicUnsupportedFrameError`

`twilicSend`, `parseTwilicMessage`, and `attachTwilicWebSocket` are stateless one-shot helpers. Stateful traffic should go through `createTwilicWebSocket(socket, { stateful: true })`.

## Runnable example

```bash
bun run example:websocket          # server from twilic/examples
bun run example:websocket:client   # client from twilic/examples
```

See [`websocket-session/`](https://github.com/twilic/examples/tree/main/websocket-session).

## Changelog

See [docs/CHANGELOG.md](docs/CHANGELOG.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
