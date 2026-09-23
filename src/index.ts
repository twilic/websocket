import {
  createSessionDecoder,
  createSessionEncoder,
  decode,
  encode,
  type SessionOptions,
  type TwilicValue,
} from "@twilic/core";

export const TWILIC_CONTENT_TYPE = "application/vnd.twilic";

export const DEFAULT_MESSAGE_LIMIT = 1_048_576;

export interface TwilicCodec {
  encode: (value: TwilicValue) => Uint8Array;
  decode: (bytes: Uint8Array) => TwilicValue;
}

export interface TwilicWebSocketOptions {
  /** Enable the Twilic WebSocket Stateful Profile. Defaults to false. */
  stateful?: boolean;
  /** Session options for this connection's encoder and decoder. */
  session?: SessionOptions;
  /** Stateless codec. Cannot be combined with `stateful: true`. */
  codec?: TwilicCodec;
  /** Reject text frames when true. Defaults to true. */
  requireBinary?: boolean;
  /** Maximum message bytes. Defaults to 1 MiB. */
  limit?: number;
  /** Called when an inbound frame fails to decode. */
  onError?: (error: unknown) => void;
}

/**
 * Socket surface shared by the browser `WebSocket` and `ws`.
 * Listener parameters stay wide so either event API is accepted directly.
 */
export interface TwilicSocket {
  send(data: Uint8Array | ArrayBuffer, options?: { binary?: boolean }): void;
  binaryType?: string;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  addEventListener?(type: string, listener: (...args: any[]) => void): void;
  removeEventListener?(type: string, listener: (...args: any[]) => void): void;
}

/** @deprecated Use {@link TwilicSocket}. Browser and `ws` sockets are both `TwilicSocket`. */
export type TwilicEventSocket = TwilicSocket;

export type TwilicMessageData =
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | Buffer
  | Buffer[]
  | string
  | null
  | undefined;

export interface TwilicMessageOptions {
  /** Reject text frames when true. Defaults to true. */
  requireBinary?: boolean;
  /**
   * When the transport provides an explicit binary flag (`ws` `isBinary`),
   * pass it here. Defaults to inferred from the data type.
   */
  isBinary?: boolean;
  /** Maximum message bytes. Defaults to 1 MiB. */
  limit?: number;
}

export interface TwilicAttachOptions extends TwilicMessageOptions {
  onError?: (error: unknown) => void;
}

export interface TwilicWebSocket<T = TwilicValue> {
  /** Encode and send one frame. Returns the bytes written to the socket. */
  send: (value: TwilicValue) => Uint8Array;
  /** Decode inbound frames once and deliver the value. Returns an unsubscribe function. */
  onMessage: (listener: (value: T) => void) => () => void;
  parseMessage: (
    data: TwilicMessageData,
    options?: TwilicMessageOptions
  ) => Promise<T>;
}

export class TwilicMessageLimitError extends Error {
  constructor() {
    super("Twilic WebSocket message exceeds limit");
    this.name = "TwilicMessageLimitError";
  }
}

export class TwilicUnsupportedFrameError extends Error {
  constructor(message = "Unsupported WebSocket frame for Twilic") {
    super(message);
    this.name = "TwilicUnsupportedFrameError";
  }
}

type SessionPair = {
  encoder: ReturnType<typeof createSessionEncoder>;
  decoder: ReturnType<typeof createSessionDecoder>;
};

function messageLimit(options?: TwilicMessageOptions): number {
  const limit = options?.limit ?? DEFAULT_MESSAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("limit must be a non-negative safe integer");
  }
  return limit;
}

function inferIsBinary(data: TwilicMessageData): boolean {
  if (typeof data === "string") {
    return false;
  }
  if (
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data) ||
    (typeof Blob !== "undefined" && data instanceof Blob) ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) ||
    Array.isArray(data)
  ) {
    return true;
  }
  return false;
}

async function toUint8Array(data: TwilicMessageData): Promise<Uint8Array> {
  if (data === null || data === undefined) {
    return new Uint8Array();
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (Array.isArray(data)) {
    return new Uint8Array(Buffer.concat(data));
  }
  throw new TwilicUnsupportedFrameError("Unsupported WebSocket message type");
}

function assertWithinLimit(bytes: Uint8Array, limit: number): void {
  if (bytes.byteLength > limit) {
    throw new TwilicMessageLimitError();
  }
}

function sendBytes(socket: TwilicSocket, bytes: Uint8Array): void {
  socket.send(bytes, { binary: true });
}

async function parseMessageWithCodec<T>(
  codec: TwilicCodec,
  data: TwilicMessageData,
  options?: TwilicMessageOptions
): Promise<T> {
  const limit = messageLimit(options);
  const requireBinary = options?.requireBinary ?? true;
  const isBinary = options?.isBinary ?? inferIsBinary(data);

  if (requireBinary && !isBinary) {
    throw new TwilicUnsupportedFrameError(
      "Twilic requires binary WebSocket frames"
    );
  }

  const bytes = await toUint8Array(data);
  assertWithinLimit(bytes, limit);
  return codec.decode(bytes) as T;
}

function bindClose(socket: TwilicSocket, onClose: () => void): void {
  if (typeof socket.on === "function") {
    socket.on("close", onClose);
    return;
  }
  socket.addEventListener?.("close", onClose);
}

function bindMessage(
  socket: TwilicSocket,
  onFrame: (data: TwilicMessageData, isBinary: boolean | undefined) => void
): () => void {
  if (socket.binaryType !== undefined) {
    socket.binaryType = "arraybuffer";
  }

  if (typeof socket.on === "function") {
    const onMessage = (data: TwilicMessageData, isBinary: boolean) => {
      onFrame(data, isBinary);
    };
    socket.on("message", onMessage);
    return () => {
      socket.off?.("message", onMessage);
    };
  }

  if (
    typeof socket.addEventListener === "function" &&
    typeof socket.removeEventListener === "function"
  ) {
    const onMessage = (event: MessageEvent) => {
      onFrame(event.data as TwilicMessageData, undefined);
    };
    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener?.("message", onMessage);
    };
  }

  throw new TypeError(
    "socket must support EventEmitter-style on/off or addEventListener/removeEventListener"
  );
}

function attachWithCodec<T>(
  codec: TwilicCodec,
  socket: TwilicSocket,
  listener: (value: T) => void,
  options?: TwilicAttachOptions
): () => void {
  messageLimit(options);
  return bindMessage(socket, (data, isBinary) => {
    void parseMessageWithCodec<T>(codec, data, {
      ...options,
      isBinary,
    })
      .then(listener)
      .catch((error: unknown) => {
        options?.onError?.(error);
      });
  });
}

const defaultCodec: TwilicCodec = {
  encode,
  decode,
};

type _Assert<T extends true> = T;
type _SocketsFit = _Assert<
  import("ws").WebSocket extends TwilicSocket
    ? WebSocket extends TwilicSocket
      ? true
      : false
    : false
>;

export function createTwilicWebSocket<T = TwilicValue>(
  socket: TwilicSocket,
  options: TwilicWebSocketOptions = {}
): TwilicWebSocket<T> {
  if (typeof socket?.send !== "function") {
    throw new TypeError(
      "createTwilicWebSocket(socket, options?) requires a WebSocket"
    );
  }

  if (options.stateful === true && options.codec) {
    throw new TypeError(
      "createTwilicWebSocket cannot combine stateful: true with a custom codec"
    );
  }

  messageLimit(options);

  const codec = options.codec ?? defaultCodec;
  const session: SessionPair | null =
    options.stateful === true
      ? {
          encoder: createSessionEncoder(options.session ?? {}),
          decoder: createSessionDecoder(options.session ?? {}),
        }
      : null;

  const activeCodec = (): TwilicCodec => {
    if (!session) {
      return codec;
    }
    return {
      encode: (value) => session.encoder.encodePatch(value),
      decode: (bytes) => session.decoder.decode(bytes),
    };
  };

  bindClose(socket, () => {
    session?.encoder.reset();
    session?.decoder.reset();
  });

  const listeners = new Set<(value: T) => void>();
  let stopListening: (() => void) | undefined;

  const ensureListening = (): void => {
    if (stopListening) {
      return;
    }
    stopListening = bindMessage(socket, (data, isBinary) => {
      void parseMessageWithCodec<T>(activeCodec(), data, {
        requireBinary: options.requireBinary,
        limit: options.limit,
        isBinary,
      })
        .then((value) => {
          for (const listener of listeners) {
            listener(value);
          }
        })
        .catch((error: unknown) => {
          options.onError?.(error);
        });
    });
  };

  return {
    send(value) {
      const bytes = activeCodec().encode(value);
      sendBytes(socket, bytes);
      return bytes;
    },
    onMessage(listener) {
      listeners.add(listener);
      ensureListening();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopListening?.();
          stopListening = undefined;
        }
      };
    },
    parseMessage(data, parseOptions) {
      return parseMessageWithCodec<T>(activeCodec(), data, {
        requireBinary: parseOptions?.requireBinary ?? options.requireBinary,
        limit: parseOptions?.limit ?? options.limit,
        isBinary: parseOptions?.isBinary,
      });
    },
  };
}

export function twilicSend(socket: TwilicSocket, value: TwilicValue): void {
  sendBytes(socket, defaultCodec.encode(value));
}

export function parseTwilicMessage<T = TwilicValue>(
  data: TwilicMessageData,
  options?: TwilicMessageOptions
): Promise<T> {
  return parseMessageWithCodec<T>(defaultCodec, data, options);
}

export function attachTwilicWebSocket<T = TwilicValue>(
  socket: TwilicSocket,
  listener: (value: T) => void,
  options?: TwilicAttachOptions
): () => void {
  return attachWithCodec<T>(defaultCodec, socket, listener, options);
}
