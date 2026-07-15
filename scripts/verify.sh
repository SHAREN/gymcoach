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
#   --full     owns an isolated test Postgres on :5434 and E2E server on :3031
#
# The full tier snapshots the canonical runtime, starts only the explicit
# gymcoach-test Compose project, and removes its own DB and E2E process in an
# EXIT trap. The default gate stays fast and hermetic.

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

TEST_DATABASE_URL="postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test"
FULL_SNAPSHOT=""
E2E_PID=""

fail() { echo ""; echo "❌ GREEN-GATE FAILED at: $1"; exit 1; }
step() { echo ""; echo "▶ $1"; }

cleanup_e2e() {
  local cleanup_status=0

  if [ -n "$E2E_PID" ]; then
    if kill -0 "$E2E_PID" >/dev/null 2>&1; then
      kill "$E2E_PID" >/dev/null 2>&1 || cleanup_status=1
      for _ in $(seq 1 40); do
        kill -0 "$E2E_PID" >/dev/null 2>&1 || break
        sleep 0.25
      done
      if kill -0 "$E2E_PID" >/dev/null 2>&1; then
        kill -KILL "$E2E_PID" >/dev/null 2>&1 || cleanup_status=1
      fi
    fi
    wait "$E2E_PID" >/dev/null 2>&1 || true
    E2E_PID=""
  fi

  node scripts/test-port.mjs wait-closed 3031 15000 || cleanup_status=1
  return "$cleanup_status"
}

cleanup_full() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM

  cleanup_e2e || cleanup_status=1
  if [ -n "$FULL_SNAPSHOT" ]; then
    node scripts/test-compose-safety.mjs down "$FULL_SNAPSHOT" || cleanup_status=1
  fi

  if [ "$original_status" -ne 0 ]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}

echo "GymCoach green-gate — node $(node -v 2>/dev/null || echo '??'), npm $(npm -v 2>/dev/null || echo '??')"

step "Codex harness integrity"
required_harness_files=(
  "AGENTS.md"
  "docs/PRODUCT.md"
  "docs/ARCHITECTURE.md"
  "docs/CURRENT_MILESTONE.md"
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
)
for harness_file in "${required_harness_files[@]}"; do
  [ -f "$harness_file" ] || fail "missing Codex harness file: $harness_file"
done
grep -q "Automatic development orchestration" AGENTS.md || fail "AGENTS.md orchestration policy"
grep -q '^# GymCoach Product$' docs/PRODUCT.md || fail "GymCoach product document"
grep -q '^## Product Contracts$' docs/PRODUCT.md || fail "GymCoach product contract"
grep -q '^# GymCoach Architecture$' docs/ARCHITECTURE.md || fail "GymCoach architecture document"
grep -q '^## Verification Map$' docs/ARCHITECTURE.md || fail "GymCoach architecture verification map"
grep -q '^# Current Milestone$' docs/CURRENT_MILESTONE.md || fail "current milestone document"
grep -q '^## Milestone State$' docs/CURRENT_MILESTONE.md || fail "current milestone state"
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

if [ "$FULL" = "1" ]; then
  step "full-gate production safety preflight"
  node scripts/test-port.mjs assert-free 3031 || fail "port 3031 preflight"
  FULL_SNAPSHOT="$(node scripts/test-compose-safety.mjs snapshot)" || fail "test Compose preflight"
  trap cleanup_full EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

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
  step "start isolated test Postgres"
  node scripts/test-compose-safety.mjs up "$FULL_SNAPSHOT" || fail "isolated test Postgres startup"

  export DATABASE_URL="$TEST_DATABASE_URL"

  step "apply migrations to isolated test Postgres"
  npx prisma migrate deploy || fail "test database migrations"

  step "integration tests"
  npx vitest run --config vitest.integration.config.ts || fail "integration tests"

  step "E2E tests (Playwright)"
  node scripts/test-port.mjs assert-free 3031 || fail "port 3031 ownership preflight"
  export JWT_SECRET="e2e-test-secret-at-least-32-characters"
  export LLM_PROVIDER="demo"
  node node_modules/next/dist/bin/next start -p 3031 &
  E2E_PID=$!
  node scripts/test-port.mjs wait-http http://127.0.0.1:3031/login 120000 || fail "E2E server startup"
  export E2E_EXTERNAL_SERVER=1
  export CI=1
  npx playwright test || fail "E2E tests"
  cleanup_e2e || fail "E2E server cleanup"

  step "scoped test cleanup and canonical runtime comparison"
  node scripts/test-compose-safety.mjs down "$FULL_SNAPSHOT" || fail "scoped test cleanup"
  FULL_SNAPSHOT=""
  trap - EXIT INT TERM
fi

echo ""
echo "✅ GREEN-GATE PASSED — safe to commit and open a PR."
