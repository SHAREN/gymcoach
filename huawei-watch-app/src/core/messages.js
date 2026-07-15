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
const MESSAGE_SOURCES = new Set(['PHONE', 'WATCH']);
const ROOT_FIELDS = Object.freeze([
  'protocolVersion',
  'schemaVersion',
  'messageId',
  'type',
  'timestamp',
  'source',
  'deviceId',
  'replyTo',
  'payload',
]);
const ROOT_FIELD_SET = new Set(ROOT_FIELDS);
const MAX_OPAQUE_ID_LENGTH = 128;

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
  return validateControlMessage({
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    messageId,
    type,
    timestamp,
    source,
    deviceId,
    replyTo,
    payload,
  });
}

export function serializeControlMessage(message, maxBytes = MAX_MESSAGE_BYTES) {
  validateControlMessage(message);
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
  return validateControlMessage(message);
}

export function validateControlMessage(message) {
  if (!isPlainObject(message)) {
    throw new Error('Control message must be an object.');
  }

  for (const field of ROOT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(message, field)) {
      throw new Error(`Control message is missing ${field}.`);
    }
  }

  for (const field of Object.keys(message)) {
    if (!ROOT_FIELD_SET.has(field)) {
      throw new Error(`Control message contains unknown field ${field}.`);
    }
  }

  if (message.protocolVersion !== PROTOCOL_VERSION || message.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('Unsupported control message version.');
  }
  validateOpaqueId(message.messageId, 'messageId');
  if (!MESSAGE_TYPES.has(message.type)) {
    throw new Error(`Unsupported control message type: ${message.type}`);
  }
  if (!Number.isInteger(message.timestamp) || message.timestamp < 0) {
    throw new Error('Control message timestamp must be a non-negative integer.');
  }
  if (!MESSAGE_SOURCES.has(message.source)) {
    throw new Error(`Unsupported control message source: ${message.source}`);
  }
  validateOpaqueId(message.deviceId, 'deviceId');
  if (message.replyTo !== null) {
    validateOpaqueId(message.replyTo, 'replyTo');
  }
  if (!isPlainObject(message.payload)) {
    throw new Error('Control message payload must be an object.');
  }

  return message;
}

function validateOpaqueId(value, field) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    codePointLength(value) > MAX_OPAQUE_ID_LENGTH
  ) {
    throw new Error(`Control message ${field} must be a non-blank string of at most 128 characters.`);
  }
}

function codePointLength(value) {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
    }
    length += 1;
  }
  return length;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
