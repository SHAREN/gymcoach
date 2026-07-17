import assert from 'node:assert/strict';

import {
  buildDraftPrBody,
  originMatchesRepository,
  validatePublicationBranch,
} from './publish-integration-draft.mjs';

assert.equal(
  validatePublicationBranch('codex/integration-gymcoach-js4', ['gymcoach-js4']),
  'codex/integration-gymcoach-js4',
);
assert.equal(
  validatePublicationBranch('chore/gymcoach-js4-integrated-artifact-gate', ['gymcoach-js4']),
  'chore/gymcoach-js4-integrated-artifact-gate',
);
assert.equal(
  validatePublicationBranch('feat/gymcoach-bk0.1-native-import', ['gymcoach-bk0.1']),
  'feat/gymcoach-bk0.1-native-import',
);
assert.throws(
  () => validatePublicationBranch('main', ['gymcoach-js4']),
  /publication branch must use codex\//,
);
assert.equal(
  originMatchesRepository('https://github.com/SHAREN/gymcoach.git', 'SHAREN/gymcoach'),
  true,
);
assert.equal(
  originMatchesRepository('git@github.com:SHAREN/gymcoach.git', 'SHAREN/gymcoach'),
  true,
);
assert.equal(
  originMatchesRepository('https://github.com/other/repo.git', 'SHAREN/gymcoach'),
  false,
);
assert.match(
  buildDraftPrBody({
    head: 'a'.repeat(40),
    taskIds: ['gymcoach-js4'],
    delivery: {
      integrated: { status: 'complete' },
      published: { status: 'not-required' },
      installed: { status: 'not-authorized' },
      deployed: { status: 'not-authorized' },
    },
  }),
  /must not be auto-merged/,
);
console.log('GitHub integration publication tests passed.');
