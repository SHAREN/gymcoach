import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ControlMessageType,
  MAX_MESSAGE_BYTES,
  MessageTooLargeError,
  createControlMessage,
  parseControlMessage,
  serializeControlMessage,
  utf8ByteLength,
} from '../src/core/messages.js';

function messageWithExactByteLength(targetBytes) {
  const message = createControlMessage({
    deviceId: 'watch-test',
    messageId: 'boundary-message',
    payload: { padding: '' },
    timestamp: 1,
    type: ControlMessageType.PING,
  });
  const baseBytes = utf8ByteLength(JSON.stringify(message));
  message.payload.padding = 'x'.repeat(targetBytes - baseBytes);
  assert.equal(utf8ByteLength(JSON.stringify(message)), targetBytes);
  return message;
}

function validMessage(overrides = {}) {
  return {
    protocolVersion: '1.0',
    schemaVersion: 1,
    messageId: 'message-1',
    type: 'PING',
    timestamp: 1,
    source: 'WATCH',
    deviceId: 'watch-1',
    replyTo: null,
    payload: {},
    ...overrides,
  };
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

test('shared control-message example parses with the watch implementation', async () => {
  const exampleUrl = new URL('../../shared-contracts/examples/control-message.json', import.meta.url);
  const serialized = await readFile(exampleUrl, 'utf8');
  const parsed = parseControlMessage(serialized);

  assert.equal(parsed.type, ControlMessageType.PING);
  assert.equal(parsed.source, 'WATCH');
  assert.equal(parsed.messageId, 'stage2-ping-001');
  assert.equal(utf8ByteLength(serialized) <= MAX_MESSAGE_BYTES, true);
});

test('parser rejects unknown fields and invalid contract values', () => {
  const invalidMessages = [
    validMessage({ unexpected: true }),
    validMessage({ source: 'SIMULATOR' }),
    validMessage({ messageId: '' }),
    validMessage({ messageId: ' ' }),
    validMessage({ messageId: 'x'.repeat(129) }),
    validMessage({ deviceId: '' }),
    validMessage({ deviceId: ' '.repeat(2) }),
    validMessage({ deviceId: 'x'.repeat(129) }),
    validMessage({ timestamp: -1 }),
    validMessage({ timestamp: 1.5 }),
    validMessage({ replyTo: '' }),
    validMessage({ replyTo: 'x'.repeat(129) }),
    validMessage({ replyTo: 1 }),
    validMessage({ payload: null }),
    validMessage({ payload: [] }),
    validMessage({ payload: 'invalid' }),
  ];

  for (const message of invalidMessages) {
    assert.throws(() => parseControlMessage(JSON.stringify(message)));
  }
});

test('parser requires every control-message root field', () => {
  for (const field of Object.keys(validMessage())) {
    const message = validMessage();
    delete message[field];
    assert.throws(() => parseControlMessage(JSON.stringify(message)));
  }
});

test('opaque ID length follows JSON Schema Unicode code points', () => {
  const accepted = validMessage({ messageId: '\ud83c\udfcb'.repeat(128) });
  assert.equal(parseControlMessage(JSON.stringify(accepted)).messageId, accepted.messageId);

  const rejected = validMessage({ messageId: '\ud83c\udfcb'.repeat(129) });
  assert.throws(() => parseControlMessage(JSON.stringify(rejected)));
});
