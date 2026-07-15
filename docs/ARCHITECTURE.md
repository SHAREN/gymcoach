# GymCoach Architecture

Status: canonical architecture orientation for Codex task preflight. Source
code, schemas, migrations, tests, and `CLAUDE.md` remain authoritative when
implementation details differ. Specialized Huawei documents under `docs/` are
authoritative for the watch integration.

## System Shape

GymCoach is primarily a Next.js 15 application serving the web interface and
HTTP APIs. PostgreSQL is the synchronized server data store. The native Android
application keeps offline operational state in Room. The Huawei Lite Wearable
companion keeps its own file-backed durable state and communicates with Android
through versioned contracts and Huawei Wear Engine.

The canonical Home PC runtime is `http://192.168.0.119:3030`. The configured
public HTTPS route proxies to that runtime. Temporary test listeners are owned
and cleaned by the verification gate.

## Main Modules

### Web, API, and Shared TypeScript

- `app/`: App Router pages and route handlers.
- `components/`: feature UI and reusable primitives.
- `lib/schemas/`: Zod request and payload contracts.
- `lib/mobile-*`: mobile bootstrap, synchronization, and API support.
- `lib/llm/`, `lib/prompts/`, and `lib/mcp/`: provider-neutral AI and MCP.
- `lib/progression.ts`, `lib/intra-set-autoregulation.ts`, and related modules:
  deterministic calculations used by web and server behavior.

### Data

- `prisma/schema.prisma` and `prisma/migrations/`: PostgreSQL schema history.
- PostgreSQL: synchronized users, programs, sessions, sets, equipment, body
  data, AI records, tokens, and mobile journal state.
- IndexedDB through Dexie: PWA offline workout mutations.
- Room: Android cache, active workout state, mutations, tombstones, and ordered
  outbox data.
- Lite file storage: watch active workout, outbox, receipts, conflicts, and
  transfer state.

PostgreSQL is authoritative for synchronized server state. Room or Lite storage
may temporarily be authoritative for unsynchronized local work. Reconciliation
must preserve newer durable mutations and expose failures instead of clearing
state silently.

### Android

- `android/app/src/main/java/org/sharteman/gymcoach/data/`: Room, API models,
  repositories, and synchronization.
- `android/app/src/main/java/org/sharteman/gymcoach/training/`: deterministic
  logic mirrored from applicable TypeScript contracts.
- `android/app/src/main/java/org/sharteman/gymcoach/watch/`: watch protocol,
  command coordination, Wear Engine transport, and diagnostics.
- `android/app/src/test/` and `android/app/src/androidTest/`: JVM and emulator
  coverage.

### Huawei Lite Wearable

- `huawei-watch-app/src/`: testable watch core, storage, transport, protocol,
  and UI state.
- `huawei-watch-app/entry/`: official production Lite Wearable application.
- `huawei-watch-app/preview-harness/`: separate Previewer project.
- `shared-contracts/`: versioned schemas and examples shared with the
  Android side.

See `docs/huawei-watch-architecture.md`,
`docs/huawei-watch-sync-protocol.md`, and
`docs/huawei-watch-gt4-capabilities.md` for the detailed watch contract.

### Operations and Task Workflow

- `scripts/verify.sh`: canonical local default and full green-gates.
- `scripts/test-compose-safety.mjs`: isolated full-gate Compose ownership and
  canonical runtime snapshot comparison.
- `docker-compose*.yml`: local, production, and test service definitions.
- `.agents/skills/`, `.codex/`, `AGENTS.md`, and `docs/CODEX_WORKFLOW.md`:
  project-local Codex and Beads lifecycle.

## Dependency and Contract Direction

1. UI calls route handlers or reusable domain modules.
2. Routes validate input, enforce authentication and ownership, then call
   domain helpers and Prisma.
3. AI and MCP write paths validate structured output before persistence.
4. Android consumes the mobile API and ports only the contracts and
   deterministic behavior required offline.
5. The watch communicates with Android through versioned messages; it does not
   bypass Android to write directly to PostgreSQL.
6. Cross-platform changes preserve identifiers, units, ordering, idempotency,
   equipment constraints, and conflict semantics across every consumer.

Avoid dependencies from core calculations into UI code. Avoid direct coupling
of product logic to one LLM provider or one debug transport.

## Verification Map

Default web/backend/shared gate:

```text
bash scripts/verify.sh
```

It verifies the Codex harness, generates Prisma, runs lint, TypeScript checks,
unit/component tests, and a production build.

Full integration gate:

```text
bash scripts/verify.sh --full
```

It snapshots the canonical runtime, owns an isolated test PostgreSQL on port
5434 and E2E server on port 3031, applies migrations, runs integration and
Playwright tests, removes only its scoped resources, and verifies that the
canonical runtime did not change.

Android code, resources, Gradle configuration, or version metadata require:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Huawei watch changes require the applicable watch unit/bundle checks, shared
contract validation, official production HAP build, Previewer HAP build, and
manual hardware or Previewer evidence when the acceptance criteria require it.
Shared mobile contracts or mirrored deterministic logic require every affected
web, Android, and watch gate.
