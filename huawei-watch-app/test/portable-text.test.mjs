import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLowerHex,
  isMachineCode,
  isUuid,
  safeFileToken,
  sanitizeMachineCode,
} from '../src/core/portable-text.js';

test('portable text validation avoids RegExp while preserving wire formats', () => {
  assert.equal(isUuid('12345678-1234-4abc-8def-1234567890ab'), true);
  assert.equal(isUuid('12345678-1234-4abc-8def-1234567890ag'), false);
  assert.equal(isUuid('1234567812344abc8def1234567890ab'), false);
  assert.equal(isLowerHex('a'.repeat(64), 64), true);
  assert.equal(isLowerHex('A'.repeat(64), 64), false);
  assert.equal(isMachineCode('SYNC_CONFLICT_4'), true);
  assert.equal(isMachineCode('sync-conflict'), false);
});

test('portable text sanitizers preserve existing normalization behavior', () => {
  assert.equal(sanitizeMachineCode('  sync: conflict / retry  '), 'SYNC_CONFLICT_RETRY');
  assert.equal(sanitizeMachineCode('***'), null);
  assert.equal(sanitizeMachineCode('a'.repeat(80)), 'A'.repeat(64));
  assert.equal(safeFileToken('a b/в.json'), 'a_b__.json');
  assert.equal(safeFileToken('x'.repeat(80)), 'x'.repeat(48));
});
