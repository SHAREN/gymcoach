# GymCoach Architecture

Status: concise orientation for development tasks. Source code, schemas, tests,
and CLAUDE.md remain authoritative when details differ.

## System Shape

GymCoach is primarily a Next.js 15 application that serves both the web
interface and HTTP APIs. PostgreSQL is the server data store. A native Android
application consumes the mobile API and keeps an offline Room database.

## Main Modules

### Web and PWA

- app/(app): authenticated App Router pages.
- app/(auth): authentication pages.
- components: React features and reusable UI components.
- components/ui: Shadcn and Radix primitives.
- i18n and messages: localization infrastructure and translations.
- public: static assets and PWA resources.

### Backend

- app/api/\*\*/route.ts: HTTP API route handlers.
- app/mcp and app/mcp/health: Streamable HTTP MCP endpoint and health route.
- lib/db.ts: Prisma access.
- lib/auth.ts and related modules: authentication and user scoping.
- lib/schemas: Zod request and payload contracts.
- lib/llm: provider-neutral AI interface.
- lib/mcp: MCP authentication, resources, prompts, and tools.

### Training and Shared TypeScript Logic

- lib/progression.ts and related modules: deterministic progression logic.
- lib/intra-set-autoregulation.ts: web/server next-set logic.
- lib/stats.ts and progress modules: calculated training metrics.
- lib/program-\*: program design, validation, generation, and context.
- lib/mobile-\*: mobile bootstrap, synchronization, and API support.

There is no separately compiled shared package. TypeScript modules under lib are
shared by web pages and server routes where appropriate. Android ports selected
contracts and deterministic logic into Kotlin.

### Android

- android/app/src/main/java/org/sharteman/gymcoach/data: Room, API models,
  networking, repositories, and synchronization.
- android/app/src/main/java/org/sharteman/gymcoach/training: deterministic
  training calculations mirrored from relevant TypeScript logic.
- android/app/src/main/java/org/sharteman/gymcoach/ui: Compose screens and UI.
- android/app/src/test: JVM unit tests.
- android/app/src/androidTest: device or emulator tests where present.

### Data and Operations

- prisma/schema.prisma and prisma/migrations: PostgreSQL schema and migrations.
- docker-compose.yml: local application and database setup.
- docker-compose.test.yml: test PostgreSQL on host port 5434.
- docker-compose.prod.yml: production stack.
- scripts/verify.sh: canonical local green-gate.
- .github/workflows/ci.yml: pull-request and main-branch CI.

## Dependency Direction

1. UI components call server actions or HTTP APIs and consume reusable lib
   modules.
2. API routes validate input with lib/schemas, enforce authentication and
   ownership, then call domain helpers and Prisma.
3. Domain helpers may call Prisma, deterministic calculation modules, or the
   provider-neutral lib/llm interface.
4. AI and MCP write paths validate structured output before persistence.
5. Android calls the mobile API, stores operational state in Room, and performs
   supported deterministic workout calculations locally.
6. PostgreSQL is authoritative for synchronized server data. Room is
   authoritative for an Android workout while local mutations remain unsynced.

Avoid dependencies from core calculations into React UI. Avoid coupling
business logic directly to a specific LLM provider.

## Public Interfaces

- Browser UI and PWA routes served by Next.js.
- HTTP API routes under /api, including authentication, sessions, programs,
  progress, backup, gyms, and mobile synchronization.
- Streamable HTTP MCP endpoint at /mcp and token-protected health route at
  /mcp/health.
- Android mobile API under /api/mobile.
- PostgreSQL schema managed exclusively through Prisma migrations.

This document does not enumerate every route. Route files and Zod schemas are
the authoritative API definitions.

## Data Stores

- PostgreSQL 16 through Prisma: server-side users, programs, sessions, sets,
  measurements, equipment, MCP tokens, and synchronization journal data.
- IndexedDB through Dexie: PWA offline session support.
- Room: native Android cache, open workout state, mutations, tombstones, and
  ordered synchronization outbox.
- Android Keystore: encryption key material for the stored mobile credential.
- Beads embedded Dolt database: project task tracking only, separate from
  product data.

## Local Run Commands

Initial setup:

```text
cp .env.example .env
npm install
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

The web application listens on port 3030. Local PostgreSQL is exposed on port 5433.

Android development requires JDK 17, Android SDK platform 35, and Android build
tools 35.0.0.

## Verification Commands

Canonical default gate:

```text
bash scripts/verify.sh
```

It runs Prisma generation, lint, TypeScript type checking, unit/component
tests, and the production build.

Full gate, after starting and migrating the test database on port 5434:

```text
docker compose -f docker-compose.test.yml up -d
npx prisma migrate deploy
bash scripts/verify.sh --full
docker compose -f docker-compose.test.yml down
```

Set DATABASE_URL to the test PostgreSQL URL when running the migration command.
CI is the authoritative example for the exact environment.

Individual commands:

```text
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:integration
npm run build
npm run test:e2e
npm run format:check
```

Android gate:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

On the current Home PC, use Git Bash explicitly for scripts/verify.sh because
bare bash resolves to WSL and that WSL environment does not have Node:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh
```

## Cross-Platform Verification Triggers

Verify both web/backend and Android when a change affects:

- mobile API request or response fields;
- lib/schemas/mobile.ts or the matching Kotlin ApiModels;
- synchronization ordering, idempotency, conflict handling, or authentication;
- deterministic training logic mirrored in Kotlin;
- shared units, identifiers, enum values, or equipment constraints;
- Android download metadata or APK publishing.

Training calculation changes also require docs/ai-coach-principles.md and the
NotebookLM research workflow. Android code, resource, Gradle, or version changes
require the Android APK publishing gate. Product work that reaches completion
must also satisfy the canonical runtime and deployment rules in AGENTS.md.
