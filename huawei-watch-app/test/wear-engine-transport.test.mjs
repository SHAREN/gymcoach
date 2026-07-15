import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { WatchCompanion } from '../src/core/companion.js';
import { parseControlMessage } from '../src/core/messages.js';
import { createVolatileStorageBackend, WatchStateRepository } from '../src/core/storage.js';
import { ConnectionState } from '../src/core/transport.js';
import { createWearEngineTransport } from '../src/platform/wear-engine-transport.js';

class FakeBuilder {
  setDescription(value) {
    this.messageInfo = value;
    this.messageType = 0;
  }

  setPayload(value) {
    this.messageInfo = JSON.stringify(value);
    this.messageType = 1;
  }
}

class FakeMessage {
  getData() {
    return this.builder.messageInfo;
  }

  getFile() {
    return JSON.parse(this.builder.messageInfo);
  }

  getType() {
    return this.builder.messageType;
  }
}

class FakeP2pClient {
  static instances = [];

  constructor() {
    this.sent = [];
    FakeP2pClient.instances.push(this);
  }

  setPeerPkgName(value) {
    this.peerPackageName = value;
  }

  setPeerFingerPrint(value) {
    this.peerFingerprint = value;
  }

  registerReceiver(receiver) {
    this.receiver = receiver;
    receiver.onSuccess();
  }

  unregisterReceiver(receiver) {
    this.unregistered = true;
    receiver.onSuccess();
  }

  send(message, callback) {
    this.sent.push(message);
    callback.onSuccess();
    callback.onSendResult({ code: 207 });
    callback.onSendProgress('100%');
  }
}

function createHarness(overrides = {}) {
  FakeP2pClient.instances = [];
  const removedOutbound = [];
  const removedInbound = [];
  const fileStore = {
    async writeOutbound(serialized) {
      this.outbound = serialized;
      return 'internal://app/watch-transfer.json';
    },
    async readInbound(name) {
      this.inboundName = name;
      return '{"received":true}';
    },
    async removeOutbound(name) {
      removedOutbound.push(name);
    },
    async removeInbound(name) {
      removedInbound.push(name);
    },
  };
  const transport = createWearEngineTransport({
    sdk: { Builder: FakeBuilder, Message: FakeMessage, P2pClient: FakeP2pClient },
    peerPackageName: 'org.sharteman.gymcoach',
    peerFingerprint: 'AA:BB:CC',
    fileStore,
    ...overrides,
  });
  return { fileStore, removedInbound, removedOutbound, transport };
}

test('platform adapter stays vendor-import free for dependency-injected Node tests', async () => {
  const source = await readFile(
    new URL('../src/platform/wear-engine-transport.js', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('@system.wearengine'), false);
});

test('connect configures the peer and registers the official P2p receiver', async () => {
  const { transport } = createHarness();
  const states = [];
  transport.setConnectionHandler(async (state, error) => states.push([state, error]));

  await transport.connect();
  await transport.connect();

  const client = FakeP2pClient.instances[0];
  assert.equal(FakeP2pClient.instances.length, 1);
  assert.equal(client.peerPackageName, 'org.sharteman.gymcoach');
  assert.equal(client.peerFingerprint, 'AA:BB:CC');
  assert.deepEqual(states, [
    [ConnectionState.CONNECTING, null],
    [ConnectionState.CONNECTED, null],
  ]);
});

test('send builds a data Message using Builder.setDescription', async () => {
  const { transport } = createHarness();
  await transport.connect();

  await transport.send('{"type":"PING"}');

  const message = FakeP2pClient.instances[0].sent[0];
  assert.equal(message.getType(), 0);
  assert.equal(message.getData(), '{"type":"PING"}');
});

test('sendFile materializes a text file and builds a file Message using Builder.setPayload', async () => {
  const { fileStore, removedOutbound, transport } = createHarness();
  await transport.connect();

  await transport.sendFile('{"payload":"large"}');

  const message = FakeP2pClient.instances[0].sent[0];
  assert.equal(fileStore.outbound, '{"payload":"large"}');
  assert.equal(message.getType(), 1);
  assert.deepEqual(message.getFile(), {
    name: 'internal://app/watch-transfer.json',
    mode: 'text',
    mode2: 'R',
  });
  assert.deepEqual(removedOutbound, ['internal://app/watch-transfer.json']);
});

test('receiver routes messages and reads file deliveries before invoking handlers', async () => {
  const { fileStore, removedInbound, transport } = createHarness();
  const messages = [];
  const files = [];
  transport.setMessageHandler(async (message) => messages.push(message));
  transport.setFileHandler(async (serialized) => files.push(serialized));
  await transport.connect();

  const client = FakeP2pClient.instances[0];
  client.receiver.onReceiveMessage('{"type":"PONG"}');
  client.receiver.onReceiveMessage({ isFileType: true, name: 'internal://app/inbound.json' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(messages, ['{"type":"PONG"}']);
  assert.equal(fileStore.inboundName, 'internal://app/inbound.json');
  assert.deepEqual(files, ['{"received":true}']);
  assert.deepEqual(removedInbound, ['internal://app/inbound.json']);
});

test('send failure rejects and reports the transport error state', async () => {
  class FailingP2pClient extends FakeP2pClient {
    send(message, callback) {
      this.sent.push(message);
      callback.onFailure();
      callback.onSendResult({ code: 206, data: 'phone unavailable' });
    }
  }
  const { transport } = createHarness({
    sdk: { Builder: FakeBuilder, Message: FakeMessage, P2pClient: FailingP2pClient },
  });
  const states = [];
  transport.setConnectionHandler(async (state, error) => states.push([state, error]));
  await transport.connect();

  await assert.rejects(transport.send('payload'), /phone unavailable/);
  assert.equal(states.at(-1)[0], ConnectionState.ERROR);
  assert.match(states.at(-1)[1].message, /phone unavailable/);
  assert.equal(FakeP2pClient.instances[0].unregistered, true);
  await assert.rejects(transport.send('payload'), /disconnected/);
});

test('send failure reconnects with a fresh client and replays the durable outbox', async () => {
  class RecoveringP2pClient extends FakeP2pClient {
    send(message, callback) {
      this.sent.push(message);
      const isFirstClient = FakeP2pClient.instances.indexOf(this) === 0;
      if (isFirstClient && this.sent.length === 2) {
        callback.onSendResult({ code: 206, data: 'temporary phone failure' });
        return;
      }
      callback.onSendResult({ code: 207 });
    }
  }
  const { transport } = createHarness({
    sdk: { Builder: FakeBuilder, Message: FakeMessage, P2pClient: RecoveringP2pClient },
  });
  let nextId = 0;
  let now = 1_000;
  const repository = new WatchStateRepository(createVolatileStorageBackend());
  const companion = new WatchCompanion({
    clock: () => ++now,
    deviceId: 'watch-recovery-test',
    idGenerator: () => `watch-recovery-${++nextId}`,
    repository,
    transport,
  });

  await companion.start();
  const pendingId = await companion.ping();

  assert.equal(companion.getState().connection, ConnectionState.ERROR);
  assert.equal(FakeP2pClient.instances[0].unregistered, true);
  assert.equal(repository.pending().some((entry) => entry.messageId === pendingId), true);

  await companion.reconnect();

  assert.equal(FakeP2pClient.instances.length, 2);
  assert.equal(companion.getState().connection, ConnectionState.CONNECTED);
  const replayed = FakeP2pClient.instances[1].sent
    .map((message) => parseControlMessage(message.getData()))
    .map((message) => message.messageId);
  assert.equal(replayed.includes(pendingId), true);
});

test('late failure from a replaced client cannot poison the fresh connection', async () => {
  class ConcurrentRecoveryP2pClient extends FakeP2pClient {
    static callbacks = [];

    send(message, callback) {
      this.sent.push(message);
      const isFirstClient = FakeP2pClient.instances.indexOf(this) === 0;
      if (isFirstClient && this.sent.length > 1) {
        ConcurrentRecoveryP2pClient.callbacks.push(callback);
        return;
      }
      callback.onSendResult({ code: 207 });
    }
  }
  const { transport } = createHarness({
    sdk: { Builder: FakeBuilder, Message: FakeMessage, P2pClient: ConcurrentRecoveryP2pClient },
  });
  let nextId = 0;
  let now = 2_000;
  const repository = new WatchStateRepository(createVolatileStorageBackend());
  const companion = new WatchCompanion({
    clock: () => ++now,
    deviceId: 'watch-concurrent-recovery-test',
    idGenerator: () => `watch-concurrent-recovery-${++nextId}`,
    repository,
    transport,
  });
  await companion.start();

  const firstPending = companion.ping();
  const latePending = companion.ping();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ConcurrentRecoveryP2pClient.callbacks.length, 2);

  ConcurrentRecoveryP2pClient.callbacks[0].onSendResult({
    code: 206,
    data: 'first concurrent failure',
  });
  await firstPending;
  assert.equal(companion.getState().connection, ConnectionState.ERROR);

  await companion.reconnect();
  const freshClient = FakeP2pClient.instances[1];
  assert.equal(companion.getState().connection, ConnectionState.CONNECTED);

  ConcurrentRecoveryP2pClient.callbacks[1].onSendResult({
    code: 206,
    data: 'late stale failure',
  });
  await latePending;
  assert.equal(companion.getState().connection, ConnectionState.CONNECTED);
  assert.equal(FakeP2pClient.instances.length, 2);
  assert.equal(freshClient.unregistered, undefined);

  await transport.disconnect();
  const laterPendingId = await companion.ping();
  const beforeLifecycleRetry = freshClient.sent
    .map((message) => parseControlMessage(message.getData()))
    .map((message) => message.messageId);
  assert.equal(beforeLifecycleRetry.includes(laterPendingId), false);

  await companion.reconnect();
  const lifecycleClient = FakeP2pClient.instances[2];
  const replayedIds = lifecycleClient.sent
    .map((message) => parseControlMessage(message.getData()))
    .map((message) => message.messageId);

  assert.equal(replayedIds.includes(laterPendingId), true);
  assert.equal(repository.pending().some((entry) => entry.messageId === laterPendingId), true);
});

test('disconnect unregisters the receiver and reports disconnected state', async () => {
  const { transport } = createHarness();
  const states = [];
  transport.setConnectionHandler(async (state) => states.push(state));
  await transport.connect();

  const client = FakeP2pClient.instances[0];
  await transport.disconnect();

  assert.equal(client.unregistered, true);
  assert.equal(states.at(-1), ConnectionState.DISCONNECTED);
  await assert.rejects(transport.send('payload'), /disconnected/);
});

test('file transport requires injected platform storage without importing a vendor file API', async () => {
  const { transport } = createHarness({ fileStore: null });
  await transport.connect();

  await assert.rejects(
    transport.sendFile('{"payload":"large"}'),
    /fileStore must provide writeOutbound\(\) and readInbound\(\)/,
  );
});
