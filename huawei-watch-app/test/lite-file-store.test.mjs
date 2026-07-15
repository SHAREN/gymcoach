import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLiteFileStore,
  createLiteStorageBackend,
} from '../src/platform/lite-file-store.js';

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

test('Lite file write failures remain visible to synchronization code', async () => {
  const fileApi = createFileApi();
  fileApi.writeText = ({ fail }) => fail('disk full', 507);
  const store = createLiteFileStore({ fileApi });

  await assert.rejects(store.writeOutbound('payload'), /disk full.*507/);
});
