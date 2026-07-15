import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('local full-gate Docker safety contract', () => {
  const compose = read('docker-compose.test.yml');
  const helper = read('scripts/test-compose-safety.mjs');
  const verify = read('scripts/verify.sh');
  const playwright = read('playwright.config.ts');
  const workflowDocs = `${read('README.md')}\n${read('CONTRIBUTING.md')}`;

  it('pins a single test-only Compose project without persistent DB storage', () => {
    expect(compose).toMatch(/^name:\s+gymcoach-test$/m);
    expect(compose).toContain('container_name: gymcoach-test-db');
    expect(compose).toContain('org.gymcoach.scope: test-only');
    expect(compose).toContain("- '5434:5432'");
    expect(compose).toContain('- /var/lib/postgresql/data');
    expect(compose).not.toMatch(/^\s+(app|db):\s*$/m);
    expect(compose).not.toMatch(/^volumes:\s*$/m);
  });

  it('uses scoped lifecycle commands and cleanup traps', () => {
    expect(helper).toContain("const COMPOSE_PROJECT = 'gymcoach-test'");
    expect(helper).toContain("const TEST_SCOPE_VALUE = 'test-only'");
    expect(helper).toContain("compose(['down', '--volumes', '--timeout', '10'])");
    expect(`${helper}\n${verify}`).not.toMatch(/\bdown\b[^\n]*--remove-orphans/);
    expect(verify).toContain('trap cleanup_full EXIT');
    expect(verify).toContain("trap 'exit 130' INT");
    expect(verify).toContain("trap 'exit 143' TERM");
    expect(verify).toContain('E2E_PID=$!');
    expect(verify).toContain('node scripts/test-compose-safety.mjs down');
  });

  it('never reuses an unknown E2E server and avoids inline shell environment syntax', () => {
    expect(playwright).toContain('reuseExistingServer: false');
    expect(playwright).toContain('env: {');
    expect(playwright).not.toMatch(/command:\s*`[^`]*DATABASE_URL=/);
  });

  it('documents the explicit Windows and WSL test project workflow', () => {
    expect(workflowDocs).toContain(
      "& 'D:\\Program Files\\Git\\bin\\bash.exe' scripts/verify.sh --full",
    );
    expect(workflowDocs).toContain('wsl.exe --cd (Get-Location).Path docker compose');
    expect(workflowDocs).toContain('--project-name gymcoach-test');
    expect(workflowDocs).toContain('Remove-Item Env:DATABASE_URL');
  });
});
