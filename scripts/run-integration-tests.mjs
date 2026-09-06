import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test';

const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'vitest.integration.config.ts',
    ...process.argv.slice(2),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL,
    },
    stdio: 'inherit',
    shell: false,
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
