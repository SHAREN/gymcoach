import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MESSAGE_BYTES,
  MessageTooLargeError,
  serializeControlMessage,
  utf8ByteLength,
} from '../src/core/messages.js';

function messageWithExactByteLength(targetBytes) {
  const message = { payload: '' };
  const baseBytes = utf8ByteLength(JSON.stringify(message));
  message.payload = 'x'.repeat(targetBytes - baseBytes);
  assert.equal(utf8ByteLength(JSON.stringify(message)), targetBytes);
  return message;
}

test('direct message accepts exactly 1,024 UTF-8 bytes', () => {
  const message = messageWithExactByteLength(MAX_MESSAGE_BYTES);
  const serialized = serializeControlMessage(message);
  assert.equal(utf8ByteLength(serialized), MAX_MESSAGE_BYTES);
});

test('direct message rejects 1,025 UTF-8 bytes', () => {
  const message = messageWithExactByteLength(MAX_MESSAGE_BYTES + 1);
  assert.throws(
    () => serializeControlMessage(message),
    (error) => error instanceof MessageTooLargeError && error.actualBytes === MAX_MESSAGE_BYTES + 1,
  );
});

test('UTF-8 measurement counts non-ASCII values as bytes', () => {
  assert.equal(utf8ByteLength('A'), 1);
  assert.equal(utf8ByteLength('\u00e9'), 2);
  assert.equal(utf8ByteLength('\u20ac'), 3);
  assert.equal(utf8ByteLength('\ud83c\udfcb'), 4);
});
