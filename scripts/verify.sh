#!/usr/bin/env bash
#
# verify.sh — the GymCoach green-gate.
#
# This is the self-verification step every autonomous loop must pass before it
# claims a task is done (see docs/loops/). It mirrors the CI "quality" + "build"
# jobs so a loop can catch its own regressions locally, in seconds, without a
# database.
#
#   PASS  -> exit 0, the working tree is safe to commit / open a PR from.
#   FAIL  -> exit non-zero, the loop must fix the reported step before retrying.
#
# Tiers:
#   (default)  prisma generate + lint + typecheck + unit tests + production build
#   --full     also runs integration + E2E (needs the test Postgres on :5434)
#
# The integration/E2E tiers need Docker + a database, so the default gate stays
# fast and hermetic; CI runs the full pyramid on every PR.

set -uo pipefail

# --- Make node 22 (nvm) available even in a non-interactive shell -------------
# The repo requires Node >= 20. The system node may be older, so prepend the
# nvm install if present. Adjust NVM_NODE if your version differs.
NVM_NODE="${NVM_NODE:-$HOME/.nvm/versions/node/v22.17.1/bin}"
if [ -d "$NVM_NODE" ]; then
  export PATH="$NVM_NODE:$PATH"
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

fail() { echo ""; echo "❌ GREEN-GATE FAILED at: $1"; exit 1; }
step() { echo ""; echo "▶ $1"; }

echo "GymCoach green-gate — node $(node -v 2>/dev/null || echo '??'), npm $(npm -v 2>/dev/null || echo '??')"

step "Codex harness integrity"
required_harness_files=(
  "AGENTS.md"
  "docs/CODEX_WORKFLOW.md"
  ".codex/config.toml"
  ".codex/hooks.json"
  ".agents/skills/beads/SKILL.md"
  ".agents/skills/beads/agents/openai.yaml"
  ".agents/skills/capture-issue/SKILL.md"
  ".agents/skills/capture-issue/agents/openai.yaml"
  ".agents/skills/triage-inbox/SKILL.md"
  ".agents/skills/triage-inbox/agents/openai.yaml"
  ".agents/skills/next-task/SKILL.md"
  ".agents/skills/next-task/agents/openai.yaml"
  ".agents/skills/execute-task/SKILL.md"
  ".agents/skills/execute-task/agents/openai.yaml"
  ".agents/skills/verify-task/SKILL.md"
  ".agents/skills/verify-task/agents/openai.yaml"
  ".agents/skills/integrate-tasks/SKILL.md"
  ".agents/skills/integrate-tasks/agents/openai.yaml"
  ".agents/skills/playwright-cli/SKILL.md"
  "scripts/check-integration-evidence.mjs"
  "scripts/close-integrated-tasks.mjs"
  "scripts/sync-beads-github.mjs"
  "scripts/publish-integration-draft.mjs"
  "scripts/cleanup-obsolete-worktree.mjs"
  "scripts/test-integration-evidence.mjs"
  "scripts/test-github-issue-mirror.mjs"
  "scripts/test-guarded-closure.mjs"
  "scripts/test-github-publication.mjs"
  "scripts/test-worktree-cleanup.mjs"
  "scripts/fixtures/integration-evidence/task-branch-only.json"
  "scripts/fixtures/integration-evidence/behavior-equivalent.json"
  "scripts/fixtures/integration-evidence/no-runtime-artifact.json"
  "scripts/fixtures/integration-evidence/android-integration.json"
  "scripts/fixtures/github-mirror/issues.json"
  "scripts/fixtures/worktree-cleanup/registered-worktree.json"
)
for harness_file in "${required_harness_files[@]}"; do
  [ -f "$harness_file" ] || fail "missing Codex harness file: $harness_file"
done
for playwright_reference in \
  element-attributes playwright-tests request-mocking running-code \
  session-management storage-state test-generation tracing video-recording; do
  [ -f ".agents/skills/playwright-cli/references/${playwright_reference}.md" ] || \
    fail "missing Playwright skill reference: ${playwright_reference}"
done
grep -q "Automatic development orchestration" AGENTS.md || fail "AGENTS.md orchestration policy"
grep -q "stage:verified" docs/CODEX_WORKFLOW.md || fail "verified integration state"
grep -q "Automatic Worktree cleanup" AGENTS.md || fail "automatic Worktree cleanup policy"
node <<'NODE' || fail "Codex harness configuration"
const fs = require('fs');

const config = fs.readFileSync('.codex/config.toml', 'utf8')
  .replace(/\r\n/g, '\n')
  .trim();
if (config !== '[features]\nhooks = true\nmulti_agent = true') {
  throw new Error('unexpected .codex/config.toml');
}

const hooks = JSON.parse(fs.readFileSync('.codex/hooks.json', 'utf8')).hooks;
const expected = {
  PostCompact: ['bd codex-hook PostCompact', 'manual|auto'],
  PreCompact: ['bd codex-hook PreCompact', 'manual|auto'],
  SessionStart: ['bd codex-hook SessionStart', 'startup|resume|clear|compact'],
  UserPromptSubmit: ['bd codex-hook UserPromptSubmit', null],
};
for (const [event, [command, matcher]] of Object.entries(expected)) {
  const groups = hooks?.[event];
  if (!Array.isArray(groups) || groups.length !== 1) {
    throw new Error(`missing hook event ${event}`);
  }
  if ((groups[0].matcher ?? null) !== matcher) {
    throw new Error(`unexpected matcher for ${event}`);
  }
  const handlers = groups[0].hooks;
  if (!Array.isArray(handlers) || handlers.length !== 1) {
    throw new Error(`unexpected handlers for ${event}`);
  }
  const handler = handlers[0];
  if (handler.type !== 'command' || handler.command !== command || handler.timeout !== 30) {
    throw new Error(`unexpected command hook for ${event}`);
  }
}
NODE

node scripts/test-integration-evidence.mjs || fail "integration evidence regression tests"
node scripts/test-github-issue-mirror.mjs || fail "GitHub issue mirror regression tests"
node scripts/test-guarded-closure.mjs || fail "guarded closure mirror-only regression tests"
node scripts/test-github-publication.mjs || fail "GitHub publication regression tests"
node scripts/test-worktree-cleanup.mjs || fail "Worktree cleanup regression tests"

step "prisma generate"
npx prisma generate >/dev/null || fail "prisma generate"

step "lint"
npm run lint || fail "lint"

step "typecheck"
npm run typecheck || fail "typecheck"

step "unit tests"
npm run test || fail "unit tests"

step "production build"
# Build needs these set but never connects; placeholders are fine and are NOT
# exported globally (so real prisma/dev commands keep using your .env).
DATABASE_URL="postgresql://user:pass@localhost:5432/db" \
JWT_SECRET="ci-build-placeholder-secret-at-least-32-chars" \
  npm run build || fail "production build"

if [ "$FULL" = "1" ]; then
  step "integration tests (needs Postgres on :5434)"
  npm run test:integration || fail "integration tests"
  step "E2E tests (Playwright)"
  npm run test:e2e || fail "E2E tests"
fi

echo ""
echo "✅ GREEN-GATE PASSED — safe to commit and open a PR."
