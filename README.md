# @twilic/websocket

WebSocket helpers for Twilic binary frames.

## Install

```bash
pnpm add @twilic/websocket @twilic/core
```

## Usage

```ts
import { init } from "@twilic/core";
import { attachTwilicWebSocket, twilicSend } from "@twilic/websocket";

await init();

const socket = new WebSocket("ws://localhost:8788");

attachTwilicWebSocket(socket, (value) => {
  console.log(value);
});

socket.addEventListener("open", () => {
  twilicSend(socket, { id: 1n, name: "alice" });
});
```

One WebSocket message equals one Twilic frame. Send binary frames only (`opcode 0x2`).

In the browser, call `init({ prefer: "wasm" })` from `@twilic/core` before using these helpers.

## Stateful profile

Enable the Twilic WebSocket Stateful Profile so each connection keeps an independent outbound encoder and inbound decoder. Callers do not need to manage `encodePatch()` themselves:

```ts
import { init } from "@twilic/core";
import { createTwilicWebSocket } from "@twilic/websocket";

await init();

const twilic = createTwilicWebSocket({
  stateful: true,
  session: { maxBaseSnapshots: 8 },
});

twilic.attach(socket, (value) => {
  console.log(value);
});

twilic.send(socket, { x: 100, y: 200, hp: 100 });
twilic.send(socket, { x: 101, y: 200, hp: 100 });
```

Reconnect opens a new directional session. Previous base snapshots are not inherited.

## API

- `TWILIC_CONTENT_TYPE`
- `DEFAULT_MESSAGE_LIMIT`
- `twilicSend(socket, value)`
- `parseTwilicMessage(data, options?)`
- `attachTwilicWebSocket(socket, listener, options?)`
- `createTwilicWebSocket(codecOrOptions?)`
- `TwilicMessageLimitError`
- `TwilicUnsupportedFrameError`

## Runnable example

```bash
pnpm example:websocket          # server from twilic/examples
pnpm example:websocket:client   # client from twilic/examples
```

See [`websocket-session/`](https://github.com/twilic/examples/tree/main/websocket-session).

## Changelog

See [docs/CHANGELOG.md](docs/CHANGELOG.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
