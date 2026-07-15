export const PROTOCOL_VERSION = '1.0';
export const SCHEMA_VERSION = 1;
export const MAX_MESSAGE_BYTES = 1024;

export const ControlMessageType = Object.freeze({
  PING: 'PING',
  PONG: 'PONG',
  SYNC_REQUESTED: 'SYNC_REQUESTED',
  SYNC_SNAPSHOT: 'SYNC_SNAPSHOT',
});

const MESSAGE_TYPES = new Set(Object.values(ControlMessageType));

export class MessageTooLargeError extends Error {
  constructor(actualBytes, maxBytes = MAX_MESSAGE_BYTES) {
    super(`Message is ${actualBytes} bytes; the limit is ${maxBytes} bytes.`);
    this.name = 'MessageTooLargeError';
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

export function utf8ByteLength(value) {
  let bytes = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export function createControlMessage({
  deviceId,
  messageId,
  payload = {},
  replyTo = null,
  source = 'WATCH',
  timestamp,
  type,
}) {
  if (!MESSAGE_TYPES.has(type)) {
    throw new Error(`Unsupported control message type: ${type}`);
  }

  if (!messageId || !deviceId || !Number.isInteger(timestamp)) {
    throw new Error('Control message requires messageId, deviceId, and integer timestamp.');
  }

  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    messageId,
    type,
    timestamp,
    source,
    deviceId,
    replyTo,
    payload,
  };
}

export function serializeControlMessage(message, maxBytes = MAX_MESSAGE_BYTES) {
  const serialized = JSON.stringify(message);
  const actualBytes = utf8ByteLength(serialized);

  if (actualBytes > maxBytes) {
    throw new MessageTooLargeError(actualBytes, maxBytes);
  }

  return serialized;
}

export function parseControlMessage(serialized, maxBytes = MAX_MESSAGE_BYTES) {
  const actualBytes = utf8ByteLength(serialized);
  if (actualBytes > maxBytes) {
    throw new MessageTooLargeError(actualBytes, maxBytes);
  }

  const message = JSON.parse(serialized);
  if (
    message === null ||
    typeof message !== 'object' ||
    message.protocolVersion !== PROTOCOL_VERSION ||
    message.schemaVersion !== SCHEMA_VERSION ||
    !MESSAGE_TYPES.has(message.type) ||
    typeof message.messageId !== 'string' ||
    typeof message.deviceId !== 'string' ||
    !Number.isInteger(message.timestamp)
  ) {
    throw new Error('Invalid control message.');
  }

  return message;
}
