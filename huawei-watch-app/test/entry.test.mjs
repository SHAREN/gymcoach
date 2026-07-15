import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const entryUrl = new URL('../entry/src/main/js/default/pages/index/index.js', import.meta.url);

test('watch page entry resolves and does not import the debug transport', async () => {
  const source = await readFile(entryUrl, 'utf8');
  assert.equal(source.includes('/debug/'), false);

  const module = await import(entryUrl.href);
  assert.equal(typeof module.default.onInit, 'function');
  assert.equal(typeof module.default.sendPing, 'function');
});
