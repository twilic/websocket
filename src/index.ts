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
  /** Session options applied to per-socket encoder and decoder. */
  session?: SessionOptions;
}

/** Minimal send surface shared by the WebSocket API and `ws`. */
export interface TwilicSocket {
  send: (
    data: Uint8Array | ArrayBuffer,
    options?: { binary?: boolean }
  ) => void;
}

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
  /**
   * Required for stateful `parseMessage`: selects the inbound decoder for this
   * WebSocket. Stateless parse ignores this field.
   */
  socket?: TwilicSocket;
}

export interface TwilicAttachOptions extends TwilicMessageOptions {
  onError?: (error: unknown) => void;
}

export interface TwilicEventSocket extends TwilicSocket {
  binaryType?: string;
  on?: (
    event: "message" | "close",
    listener:
      | ((data: TwilicMessageData, isBinary: boolean) => void)
      | (() => void)
  ) => unknown;
  off?: (
    event: "message" | "close",
    listener:
      | ((data: TwilicMessageData, isBinary: boolean) => void)
      | (() => void)
  ) => unknown;
  addEventListener?: (
    type: "message" | "close",
    listener: ((event: MessageEvent) => void) | (() => void)
  ) => void;
  removeEventListener?: (
    type: "message" | "close",
    listener: ((event: MessageEvent) => void) | (() => void)
  ) => void;
}

export interface TwilicWebSocket<T = TwilicValue> {
  send: (socket: TwilicSocket, value: TwilicValue) => void;
  parseMessage: (
    data: TwilicMessageData,
    options?: TwilicMessageOptions
  ) => Promise<T>;
  attach: (
    socket: TwilicEventSocket,
    listener: (value: T) => void,
    options?: TwilicAttachOptions
  ) => () => void;
  /**
   * Drop session state for `socket`. Stateful profiles emit a full frame on
   * the next `send()`. Stateless profiles ignore this call.
   */
  reset: (socket: TwilicSocket) => void;
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

function isTwilicCodec(value: unknown): value is TwilicCodec {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TwilicCodec).encode === "function" &&
    typeof (value as TwilicCodec).decode === "function" &&
    !("stateful" in value)
  );
}

function sendWithCodec(
  codec: TwilicCodec,
  socket: TwilicSocket,
  value: TwilicValue
): void {
  const bytes = codec.encode(value);
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

function attachWithCodec<T>(
  codec: TwilicCodec,
  socket: TwilicEventSocket,
  listener: (value: T) => void,
  options?: TwilicAttachOptions
): () => void {
  messageLimit(options);

  if (socket.binaryType !== undefined) {
    socket.binaryType = "arraybuffer";
  }

  const handleError = (error: unknown) => {
    if (options?.onError) {
      options.onError(error);
    }
  };

  if (typeof socket.on === "function") {
    const onMessage = (data: TwilicMessageData, isBinary: boolean) => {
      void parseMessageWithCodec<T>(codec, data, {
        ...options,
        isBinary,
      })
        .then(listener)
        .catch(handleError);
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
      void parseMessageWithCodec<T>(codec, event.data as TwilicMessageData, {
        ...options,
        isBinary:
          options?.isBinary ?? inferIsBinary(event.data as TwilicMessageData),
      })
        .then(listener)
        .catch(handleError);
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

function createStatefulTwilicWebSocket<T = TwilicValue>(
  sessionOptions: SessionOptions = {}
): TwilicWebSocket<T> {
  const sessions = new WeakMap<object, SessionPair>();

  const getSession = (socket: TwilicSocket): SessionPair => {
    const key = socket as object;
    let pair = sessions.get(key);
    if (!pair) {
      pair = {
        encoder: createSessionEncoder(sessionOptions),
        decoder: createSessionDecoder(sessionOptions),
      };
      sessions.set(key, pair);
    }
    return pair;
  };

  const discardSession = (socket: TwilicSocket): void => {
    const key = socket as object;
    const pair = sessions.get(key);
    if (!pair) {
      return;
    }
    pair.encoder.reset();
    pair.decoder.reset();
    sessions.delete(key);
  };

  const bindClose = (socket: TwilicEventSocket): void => {
    const onClose = () => {
      discardSession(socket);
    };
    if (typeof socket.on === "function") {
      socket.on("close", onClose);
      return;
    }
    socket.addEventListener?.("close", onClose);
  };

  return {
    send(socket, value) {
      const { encoder } = getSession(socket);
      const bytes = encoder.encodePatch(value);
      socket.send(bytes, { binary: true });
    },
    parseMessage(data, options) {
      if (!options?.socket) {
        return Promise.reject(
          new TypeError(
            "stateful parseMessage requires options.socket for the inbound session decoder"
          )
        );
      }
      const { decoder } = getSession(options.socket);
      return parseMessageWithCodec<T>(
        {
          encode,
          decode: (bytes) => decoder.decode(bytes),
        },
        data,
        options
      );
    },
    attach(socket, listener, options) {
      bindClose(socket);
      const { decoder } = getSession(socket);
      return attachWithCodec<T>(
        {
          encode,
          decode: (bytes) => decoder.decode(bytes),
        },
        socket,
        listener,
        options
      );
    },
    reset(socket) {
      const pair = sessions.get(socket as object);
      if (!pair) {
        return;
      }
      pair.encoder.reset();
      pair.decoder.reset();
    },
  };
}

const defaultCodec: TwilicCodec = {
  encode,
  decode,
};

export function createTwilicWebSocket<T = TwilicValue>(
  codecOrOptions: TwilicCodec | TwilicWebSocketOptions = defaultCodec
): TwilicWebSocket<T> {
  if (
    typeof codecOrOptions === "object" &&
    codecOrOptions !== null &&
    "stateful" in codecOrOptions &&
    codecOrOptions.stateful === true &&
    typeof (codecOrOptions as TwilicCodec).encode === "function"
  ) {
    throw new TypeError(
      "createTwilicWebSocket cannot combine stateful: true with a custom codec"
    );
  }

  if (isTwilicCodec(codecOrOptions)) {
    return {
      send: (socket, value) => sendWithCodec(codecOrOptions, socket, value),
      parseMessage: (data, options) =>
        parseMessageWithCodec<T>(codecOrOptions, data, options),
      attach: (socket, listener, options) =>
        attachWithCodec<T>(codecOrOptions, socket, listener, options),
      reset() {},
    };
  }

  if (codecOrOptions.stateful === true) {
    return createStatefulTwilicWebSocket<T>(codecOrOptions.session ?? {});
  }

  return {
    send: (socket, value) => sendWithCodec(defaultCodec, socket, value),
    parseMessage: (data, options) =>
      parseMessageWithCodec<T>(defaultCodec, data, options),
    attach: (socket, listener, options) =>
      attachWithCodec<T>(defaultCodec, socket, listener, options),
    reset() {},
  };
}

export function twilicSend(socket: TwilicSocket, value: TwilicValue): void {
  sendWithCodec(defaultCodec, socket, value);
}

export function parseTwilicMessage<T = TwilicValue>(
  data: TwilicMessageData,
  options?: TwilicMessageOptions
): Promise<T> {
  return parseMessageWithCodec<T>(defaultCodec, data, options);
}

export function attachTwilicWebSocket<T = TwilicValue>(
  socket: TwilicEventSocket,
  listener: (value: T) => void,
  options?: TwilicAttachOptions
): () => void {
  return attachWithCodec<T>(defaultCodec, socket, listener, options);
}
