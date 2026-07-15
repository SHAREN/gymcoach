import assert from 'node:assert/strict';
import test from 'node:test';

import { WatchCompanion } from '../src/core/companion.js';
import {
  ControlMessageType,
  createControlMessage,
  parseControlMessage,
  serializeControlMessage,
} from '../src/core/messages.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import { createDebugTransportPair } from '../src/debug/debug-transport.js';

function sequence(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function clock(start = 1_000) {
  let value = start;
  return () => ++value;
}

async function createHarness() {
  const transports = createDebugTransportPair();
  const watchClock = clock(10_000);
  const phoneClock = clock(20_000);
  const watchRepository = new WatchStateRepository(createVolatileStorageBackend());
  const watch = new WatchCompanion({
    clock: watchClock,
    deviceId: 'watch-test',
    idGenerator: sequence('watch'),
    repository: watchRepository,
    transport: transports.watch,
  });
  const phone = new WatchCompanion({
    clock: phoneClock,
    deviceId: 'phone-test',
    idGenerator: sequence('phone'),
    repository: new WatchStateRepository(createVolatileStorageBackend()),
    source: 'PHONE',
    transport: transports.phone,
  });

  await transports.phone.connect();
  await watch.start();
  return { phone, transports, watch, watchRepository };
}

test('ping receives one pong and clears the pending ping', async () => {
  const { phone, transports, watch, watchRepository } = await createHarness();
  await phone.start();

  const pingId = await watch.ping();
  const watchMessages = transports.watch.sent.map((serialized) => parseControlMessage(serialized));
  const phoneMessages = transports.phone.sent.map((serialized) => parseControlMessage(serialized));

  assert.equal(watchMessages.some((message) => message.messageId === pingId), true);
  assert.equal(phoneMessages.some((message) => message.type === ControlMessageType.PONG), true);
  assert.equal(watch.getState().lastPongAt !== null, true);
  assert.equal(watch.getState().pendingCount >= 1, true);
  assert.equal(watchRepository.pending().some((message) => message.messageId === pingId), false);
  assert.equal(
    watchMessages.filter((message) => message.messageId === pingId).length,
    1,
  );
});

test('reconnect sends a new state request after replaying pending messages', async () => {
  const { transports, watch } = await createHarness();
  const before = transports.watch.sent.map((serialized) => parseControlMessage(serialized));
  const beforeRequests = before.filter((message) => message.type === ControlMessageType.SYNC_REQUESTED).length;

  await transports.watch.reconnect();

  const after = transports.watch.sent.map((serialized) => parseControlMessage(serialized));
  const afterRequests = after.filter((message) => message.type === ControlMessageType.SYNC_REQUESTED).length;
  const requestIds = new Set(
    after
      .filter((message) => message.type === ControlMessageType.SYNC_REQUESTED)
      .map((message) => message.messageId),
  );
  assert.equal(beforeRequests, 1);
  assert.equal(afterRequests, 2);
  assert.equal(requestIds.size, 1);
  assert.equal(watch.getState().connection, 'connected');
  assert.equal(watch.getState().syncStatus, 'requesting');
});

test('duplicate inbound ping stays idempotent across a watch restart', async () => {
  const transportPair = createDebugTransportPair();
  const backend = createVolatileStorageBackend();
  const repository = new WatchStateRepository(backend);
  const watch = new WatchCompanion({
    clock: clock(),
    deviceId: 'watch-test',
    idGenerator: sequence('watch'),
    repository,
    transport: transportPair.watch,
  });
  await transportPair.phone.connect();
  await watch.start();

  const ping = createControlMessage({
    deviceId: 'phone-test',
    messageId: 'phone-ping-1',
    timestamp: 1,
    type: ControlMessageType.PING,
  });
  const serialized = serializeControlMessage(ping);
  await transportPair.watch.inject(serialized);
  await transportPair.watch.inject(serialized);

  await watch.stop();
  const restartedWatch = new WatchCompanion({
    clock: clock(2_000),
    deviceId: 'watch-test',
    idGenerator: sequence('restarted-watch'),
    repository: new WatchStateRepository(backend),
    transport: transportPair.watch,
  });
  await restartedWatch.start();
  await transportPair.watch.inject(serialized);

  const pongs = transportPair.watch.sent
    .map((serializedMessage) => parseControlMessage(serializedMessage))
    .filter((message) => message.type === ControlMessageType.PONG && message.replyTo === ping.messageId);
  assert.equal(pongs.length, 1);

  const reloadedRepository = new WatchStateRepository(backend);
  const document = await reloadedRepository.load();
  assert.equal(document.receipts.includes(ping.messageId), true);
});

test('pending control state survives repository recreation', async () => {
  const backend = createVolatileStorageBackend();
  const first = new WatchStateRepository(backend);
  await first.load();
  await first.enqueue(
    createControlMessage({
      deviceId: 'watch-test',
      messageId: 'persisted-request',
      timestamp: 1,
      type: ControlMessageType.SYNC_REQUESTED,
    }),
  );

  const second = new WatchStateRepository(backend);
  const restored = await second.load();
  assert.deepEqual(restored.outbox.map((message) => message.messageId), ['persisted-request']);
});
