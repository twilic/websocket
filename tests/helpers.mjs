import http from "node:http";

import { WebSocketServer } from "ws";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export { encoder, decoder };

export function createJsonCodec() {
  return {
    encode(value) {
      return encoder.encode(JSON.stringify(value));
    },
    decode(bytes) {
      if (bytes.length === 0) {
        return null;
      }
      return JSON.parse(decoder.decode(bytes));
    },
  };
}

export function createTrackingCodec(inner = createJsonCodec()) {
  const stats = {
    encodeCalls: 0,
    decodeCalls: 0,
    lastEncoded: null,
    lastDecoded: null,
  };
  return {
    stats,
    encode(value) {
      stats.encodeCalls += 1;
      stats.lastEncoded = value;
      return inner.encode(value);
    },
    decode(bytes) {
      stats.decodeCalls += 1;
      stats.lastDecoded = bytes;
      return inner.decode(bytes);
    },
  };
}

export async function createEchoWebSocketServer() {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      socket.send(data, { binary: isBinary });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `ws://127.0.0.1:${port}`;

  return {
    url,
    close() {
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise((resolve, reject) => {
        wss.close((wssError) => {
          if (wssError) {
            reject(wssError);
            return;
          }
          server.close((error) => (error ? reject(error) : resolve()));
        });
      });
    },
  };
}

export function onceOpen(socket) {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = () => {
      socket.off?.("open", onOpen);
      socket.off?.("error", onError);
      socket.removeEventListener?.("open", onOpen);
      socket.removeEventListener?.("error", onError);
    };
    if (typeof socket.once === "function") {
      socket.once("open", onOpen);
      socket.once("error", onError);
      return;
    }
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
  });
}

export function onceMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (eventOrData, isBinary) => {
      cleanup();
      if (
        eventOrData &&
        typeof eventOrData === "object" &&
        "data" in eventOrData &&
        !(eventOrData instanceof Uint8Array) &&
        !(typeof Buffer !== "undefined" && Buffer.isBuffer(eventOrData))
      ) {
        resolve({ data: eventOrData.data, isBinary: undefined });
        return;
      }
      resolve({ data: eventOrData, isBinary });
    };
    const onError = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cleanup = () => {
      socket.off?.("message", onMessage);
      socket.off?.("error", onError);
      socket.removeEventListener?.("message", onMessage);
      socket.removeEventListener?.("error", onError);
    };
    if (typeof socket.once === "function") {
      socket.once("message", onMessage);
      socket.once("error", onError);
      return;
    }
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}
