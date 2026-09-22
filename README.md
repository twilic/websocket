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

Stateful `encodePatch` sessions can send frames by injecting a custom codec. `@twilic/core` currently exposes session encode APIs; patch decode may require a matching session decoder in your language SDK.

## API

- `TWILIC_CONTENT_TYPE`
- `DEFAULT_MESSAGE_LIMIT`
- `twilicSend(socket, value)`
- `parseTwilicMessage(data, options?)`
- `attachTwilicWebSocket(socket, listener, options?)`
- `createTwilicWebSocket(codec?)`
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
