import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLiteFileStore,
  createLiteStorageBackend,
} from '../src/platform/lite-file-store.js';
import { WatchStateRepository } from '../src/core/storage.js';

function createFileApi() {
  const files = new Map();
  return {
    files,
    writeText({ success, text, uri }) {
      files.set(uri, text);
      success();
    },
    readText({ fail, success, uri }) {
      if (!files.has(uri)) {
        fail('not found', 301);
        return;
      }
      success({ text: files.get(uri) });
    },
    delete({ fail, success, uri }) {
      if (!files.delete(uri)) {
        fail('not found', 301);
        return;
      }
      success();
    },
  };
}

test('Lite file store writes bounded internal paths and reads inbound payloads', async () => {
  const fileApi = createFileApi();
  const store = createLiteFileStore({ fileApi, now: () => 1234 });

  const descriptor = await store.writeOutbound('{"event":true}');
  assert.deepEqual(descriptor, {
    mode: 'text',
    mode2: 'R',
    name: 'internal://app/gymcoach-1234-1.json',
  });
  assert.equal(await store.readInbound(descriptor.name), '{"event":true}');

  await store.removeOutbound(descriptor.name);
  assert.equal(fileApi.files.has(descriptor.name), false);
  await store.removeOutbound(descriptor.name);
});

test('Lite storage backend persists the durable watch document', async () => {
  const fileApi = createFileApi();
  const backend = createLiteStorageBackend({ fileApi });

  assert.equal(await backend.get('ignored'), null);
  await backend.set('ignored', '{"version":6}');
  assert.equal(await backend.get('ignored'), '{"version":6}');
  await backend.remove('ignored');
  assert.equal(await backend.get('ignored'), null);
});

test('non-not-found reads reject without replacing durable workout state', async () => {
  const fileApi = createFileApi();
  const stateUri = 'internal://app/test-watch-state.json';
  const backend = createLiteStorageBackend({ fileApi, stateUri });
  const repository = new WatchStateRepository(backend);
  await repository.load();
  await repository.enqueue({ messageId: 'pending-message' });
  await repository.saveActiveWorkout({
    session: { sessionId: 'active-session', status: 'ACTIVE' },
  });
  const persisted = fileApi.files.get(stateUri);

  let writes = 0;
  const writeText = fileApi.writeText.bind(fileApi);
  fileApi.writeText = (options) => {
    writes += 1;
    writeText(options);
  };
  fileApi.readText = ({ fail }) => fail('permission denied', 403);

  const restored = new WatchStateRepository(backend);
  await assert.rejects(restored.load(), /permission denied.*403/);

  assert.equal(writes, 0);
  assert.equal(fileApi.files.get(stateUri), persisted);
  const document = JSON.parse(persisted);
  assert.equal(document.activeWorkout.session.sessionId, 'active-session');
  assert.deepEqual(document.outbox.map((entry) => entry.messageId), ['pending-message']);
});

test('non-not-found delete failures remain visible for every Lite delete path', async () => {
  const fileApi = createFileApi();
  fileApi.delete = ({ fail }) => fail('permission denied', 403);
  const store = createLiteFileStore({ fileApi });
  const backend = createLiteStorageBackend({ fileApi });

  for (const remove of [
    () => store.removeOutbound('internal://app/outbound.json'),
    () => store.removeInbound('internal://app/inbound.json'),
    () => backend.remove('ignored'),
  ]) {
    await assert.rejects(remove, /permission denied.*403/);
  }
});

test('Lite file write failures remain visible to synchronization code', async () => {
  const fileApi = createFileApi();
  fileApi.writeText = ({ fail }) => fail('disk full', 507);
  const store = createLiteFileStore({ fileApi });

  await assert.rejects(store.writeOutbound('payload'), /disk full.*507/);
});
