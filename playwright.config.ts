import { defineConfig, devices } from '@playwright/test';

// End to end tests. The web server runs a production build against the test
// database (docker-compose.test.yml). Build the app and apply migrations
// first; in CI the e2e job does both before invoking Playwright.
const PORT = 3031;
const TEST_DB =
  process.env.E2E_DATABASE_URL ??
  'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test';
const USE_EXTERNAL_SERVER = process.env.E2E_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: USE_EXTERNAL_SERVER
    ? undefined
    : {
        // Environment is passed separately so this command works in cmd.exe,
        // PowerShell, Git Bash and POSIX shells.
        command: `next start -p ${PORT}`,
        env: {
          DATABASE_URL: TEST_DB,
          JWT_SECRET: 'e2e-test-secret-at-least-32-characters',
          LLM_PROVIDER: 'demo',
        },
        url: `http://localhost:${PORT}/login`,
        timeout: 120_000,
        // Never attach to an unknown process on the shared full-gate port.
        reuseExistingServer: false,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
