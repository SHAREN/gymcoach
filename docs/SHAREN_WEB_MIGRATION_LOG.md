# SHAREN Web Migration — development / handoff log

> **Purpose:** persistent continuation journal for the clean GymCoach web migration. A new ChatGPT thread or developer should read this file first, then `docs/SHAREN_WEB_MIGRATION.md`, `docs/SHAREN_WEB_MIGRATION_PLAN.md`, `docs/chatgpt-mcp.md`, and `docs/PROJECT_GOALS.md` before changing code.
>
> **Rule:** keep this file current after every meaningful implementation, verification, failure/root-cause finding, architectural decision, commit, or blocker. Do not rely on chat history as the only record.

## Continuation contract

- Canonical working tree: `D:\codexpro_workspace\gymcoach-web-migration`
- Branch: `migration/web-upstream-clean`
- Work directly through `@home-PC` / CodexPro workspace tools. Do **not** launch Codex or create Codex Threads for implementation; user explicitly stopped Codex-based development.
- Never create a parallel writer while this working tree is safe to continue.
- No Android or Huawei source may enter this clean web branch.
- External-AI-over-MCP architecture is mandatory: semantic interpretation of free text, exercise names, photos and context belongs to the external MCP agent. Do not add a GymCoach embedded LLM proposal pipeline or web AI proposal/review screens for the migration workflow.
- For MCP writes: ownership, selected gym scope, compatibility, idempotency where applicable, and explicit confirmation are mandatory.
- Rejected implementation `599cb2df32714b51f7638c8961e5695b450bd3a2` must never return; it was reverted by `d687473`.
- Work chain for each functional block: implementation -> focused tests/typecheck/build -> fixes -> independent verification when required -> guarded integration/final gate.
- One functional block = separate commit. Do not blind cherry-pick legacy monorepo commits.

## Current state snapshot

### Git

- Current immutable HEAD before the in-progress M14 work: `1d80feead6bdd2598a9824875c36170109bfe56f` (`1d80fee test: fix cross-platform and stale expectations`).
- Branch is ahead of `origin/migration/web-upstream-clean` by 16 commits at this point.
- Untracked local-only items that must not be committed: `.gymcoach-interactive-chat.lock`, `node_modules`.

### Completed migration blocks

- M01 exercise catalog/replacement filters — DONE.
- M02 MCP read tools gyms/inventory/training history — DONE.
- M03 MCP equipment write operations — DONE.
- M04 completed workout/history set editor — DONE.
- M05 preferred equipment per exercise/gym — DONE.
- M06 exercise detail/equipment editor — DONE.
- M07 durable web set acknowledgement/replay — DONE.
- M08 equipment-aware return-to-training — DONE.
- M09 session exercise strip/navigation — DONE.
- M10 set value picker/editable set table — DONE.
- M11 structured coaching profile — DONE, commit `393dc0e`.
- M12 program revisions/design context/validation — DONE, commit `1c7a94d`.
- M13 multi-muscle load accounting — DONE, commit `7354f81`.
- Test cleanup after M13 — DONE, commit `1d80fee`.

### Latest quality evidence before M14

- Full unit suite after cleanup: **119 files / 1081 tests passed**.
- `npm run typecheck`: green.
- Focused cleanup tests: 24/24 green.
- M13 production build was green; only the pre-existing `lib/import/gpx.ts` warning remained.
- M13 integration evidence on correct container DB was green: 76/76 earlier, plus subsequent focused M13/backup checks; M13 commit remained isolated.

## Important completed architecture decisions

### M12

- `get_program_design_context` and `validate_program_draft` are deterministic/read-only domain/MCP paths.
- Program revisions are inactive by default and preserve lineage via `parentProgramId` + `methodologyVersion` (historical field name retained for schema compatibility; it records the deterministic program-design contract/version, not an embedded LLM).
- The existing generator route was not expanded into a new internal AI methodology pipeline.

### M13

- Multi-muscle load profile is additive; existing upstream progress/stats UI remains unchanged.
- Server-owned provenance is required for trusted reviewed load profiles.
- A custom exercise is never upgraded to trusted/reviewed merely because its name matches a system exercise; full fingerprint/provenance hardening is used.
- Backup restore re-derives trust and does not trust imported `REVIEWED` metadata blindly.
- MCP/history/program-design use direct/indirect/equivalent deterministic aggregation.

## 2026-09-05 — test cleanup after M13

### Problem found

Full unit suite after M13 had five failures unrelated to M13 behavior:

1. Windows `progress-photo` expectations assumed POSIX permission bits.
2. `photoRelativePath` returned a platform-native separator, causing a Windows path expectation mismatch.
3. M11 coaching-profile test asserted old copy.
4. M08/session gym selection test asserted the old smaller equipment select.

### Fix

- `photoRelativePath` now uses `path.posix.join` for the persisted relative key.
- POSIX mode assertions run only off Windows; containment/security tests remain unchanged.
- Coaching-profile assertion updated to the actual current safety copy.
- Session gym selection expectation includes `equipmentType`, `loadConfigurationKnown`, and `weightOptions`.

### Verification

- Focused: 24/24 green.
- Full `npm test`: **1081/1081 green**.
- `npm run typecheck`: green.
- `git diff --check`: green.
- Commit: `1d80fee test: fix cross-platform and stale expectations`.

## 2026-09-05 — M14 Permanent free-weight system profiles — IN PROGRESS

### Upstream / legacy audit

- Current upstream reference in this checkout is `f4cc2a9` (`docs: write up the 2026-09-04 wave...`).
- Clean branch still has only legacy shared gym arrays (`dumbbellWeights`, `plateWeights`, `barWeights`) plus simplified physical equipment.
- Legacy SHAREN final implementation has permanent `Dumbbells` and `Barbell` system profiles, two Barbell diameter families, named compatible plate pools, explicit equipment load mechanics, and protected system members.
- Primary legacy M14 commit: `9b2a36a8 feat: add permanent free-weight system profiles` (~4k lines, mixed web/server + Android).
- The old implementation depended on an earlier common `equipment-first load domain` (`ec80b3af`) plus hardening fixes. The clean branch intentionally did not port that entire layer.
- Decision: **do not blind cherry-pick** `ec80b3af` or `9b2a36a8`. Implement the minimum common web/server domain required by M14 while preserving the already-integrated clean-branch MCP/Hammer safety model.

### M14 architecture selected

M14 is additive and fail-closed:

1. Preserve existing `Gym.dumbbellWeights`, `Gym.plateWeights`, `Gym.barWeights` for compatibility.
2. Preserve `GymEquipment.loadConfigurationKnown` as the explicit unknown/known boundary.
3. Add confirmed structured load facts alongside it:
   - `EquipmentLoadType`: `NONE | FIXED | SELECTORIZED | PLATE_LOADED`
   - `selectedLoadMultiplier`
   - `baseLoadKg`
   - `loadingSides`
   - optional `platePoolId`
4. Add named `GymPlatePool` + `GymPlateInventoryItem`; nullable plate quantity means denomination known, physical count unknown.
5. Add two permanent Barbell compatibility families: `LARGE`, `SMALL`.
6. Add nullable `GymExerciseConfig.systemProfileSupported` for explicit Dumbbells/Barbell membership.
7. Managed system bars get `systemBarbellFamily`; custom equipment stays `NULL` and remains editable through normal equipment APIs.
8. Read-only MCP must not mutate data to initialize profiles. System pools/profiles are created by migration and gym creation/write paths instead.
9. Unknown Hammer / unknown-load equipment must remain representable with `loadConfigurationKnown=false`. No load type, base load, manufacturer, model, plate mechanics, or selectable weights are inferred merely because an external agent recognized the equipment semantically.
10. M14 system-profile APIs are deterministic data operations; semantic interpretation remains in the external MCP agent.

### M14 implementation already made (UNCOMMITTED / IN PROGRESS)

Dirty tracked/new files at the time this journal entry was created:

- `M prisma/schema.prisma`
- `?? prisma/migrations/20260905212000_add_permanent_free_weight_profiles/migration.sql`
- `M lib/schemas/gym-equipment.ts`
- `M lib/gym-loads.ts`

#### `prisma/schema.prisma`

Added:

- `EquipmentLoadType` enum.
- `BarbellDiameterFamily` enum.
- `Gym.platePools` relation.
- nullable `GymExerciseConfig.systemProfileSupported`.
- `GymEquipment.loadType`, `selectedLoadMultiplier`, `baseLoadKg`, `platePoolId`, `loadingSides`, `systemBarbellFamily`; old `loadConfigurationKnown` stays.
- `GymPlatePool` and `GymPlateInventoryItem`.
- indexes for system family and plate pool.

`npx prisma validate` and `npx prisma generate` were green immediately after this schema change.

#### Migration `20260905212000_add_permanent_free_weight_profiles`

Current migration intent:

- Create new enums/tables/columns/indexes/FKs.
- Create exactly two system plate pools per existing gym (`LARGE`, `SMALL`).
- Copy existing `Gym.plateWeights` denominations only into the LARGE system pool with `quantity=NULL` (do not invent physical counts).
- Materialize existing positive `Gym.barWeights` as LARGE managed system bars only; SMALL family intentionally starts with no bar rather than inventing one.
- Existing explicit free-weight availability becomes initial system-profile membership.
- Missing DUMBBELL/BARBELL configs are made explicitly supported to preserve old implicit availability semantics.
- Managed bars are linked only to explicitly supported BARBELL exercises.
- Existing physical equipment rows are **not** assigned structured load mechanics by the migration, so `loadConfigurationKnown=false` machines remain unknown.

The migration has not yet been deployed/tested on the real test DB after creation. That is the next required DB gate after domain compilation is green.

#### `lib/schemas/gym-equipment.ts`

Reworked input validation for the new load facts and system profiles:

- Plate compatibility key and plate pool schemas.
- Equipment load facts.
- Fail-closed rule: `loadConfigurationKnown=false` cannot be combined with confirmed non-default mechanics (non-NONE load type, weights, plate pool, non-zero base load, non-1 multiplier, non-default sides).
- FIXED/SELECTORIZED require displayed loads.
- PLATE_LOADED requires a plate pool; other types may not reference one.
- Added strict inputs for Dumbbells system profile and two Barbell families.
- The system family schema currently allows zero bars in a family so SMALL can remain honestly empty instead of inventing hardware.

#### `lib/gym-loads.ts`

Expanded the existing legacy load helper with an additive equipment profile domain:

- `PlateInventoryItem`
- `EquipmentLoadProfile`
- `ResolvedEquipmentLoadProfile`
- `resolveEquipmentType`
- `resolveEquipmentLoadProfile`
- `constructiblePlateLoadedWeights`
- existing dumbbell/barbell legacy helpers retained.
- `UNKNOWN_CONFIG` produces no attainable loads rather than guessing.
- When equipment options exist, multiple physical machines are never unioned into one progression scale; an explicit equipment selection is required unless there is exactly one option.
- Architecture correction made during M14: the legacy `resolveEquipmentType` name/regex inference was deliberately **not** kept. The helper now returns the explicit canonical `equipmentType` only. Exercise-name/free-text semantic classification belongs to the external MCP agent, per the project architecture.

This file was written immediately before the user requested persistent journaling.

### M14 focused gate update

- Added focused tests for unknown Hammer/load configuration, finite vs unknown plate quantities, plate-loaded validation, LARGE/SMALL family completeness, and duplicate bar/plate rejection.
- `npx vitest run lib/gym-loads.test.ts lib/schemas/gym-equipment.test.ts`: **15/15 passed**.
- `git diff --check`: no whitespace errors reported before the typecheck failure.
- `npm run typecheck` currently fails only in existing MCP schema-composition code because `gymEquipmentUpsertSchema` became a refined `ZodEffects` and the MCP code calls `.omit` / `.shape` on it. Reported locations: `lib/mcp/external-ai-workflow.ts` around line 50/269-287 and `lib/mcp/server.ts` around line 383/392. Root cause is schema composition/API shape, not the new load-domain tests.
- Fix applied: exported strict `gymEquipmentUpsertObjectSchema` for MCP `.omit/.shape` composition while keeping `gymEquipmentUpsertSchema` as the refined write validator. Updated `lib/mcp/external-ai-workflow.ts` and `lib/mcp/server.ts` to use the object schema only for tool-schema composition.
- Re-run after fix: `lib/gym-loads.test.ts` + `lib/schemas/gym-equipment.test.ts` + `lib/mcp/server.test.ts` = **16/16 passed**; `npm run typecheck` green; `git diff --check` green.
- Added new `lib/gym-system-profiles.ts`. It keeps system-profile reads read-only, provides write-path initialization for missing LARGE/SMALL pools, saves Dumbbells and Barbell profiles with ownership/type checks, preserves nullable plate counts, blocks removing a managed bar selected by an active session, protects system bars/pools from generic mutation, links managed bars only to explicitly supported BARBELL exercises, and mirrors managed bar/large-family plate facts back to legacy arrays for compatibility. After adding it, typecheck + the same 16 focused tests remained green.
- Hardened generic exercise-equipment editing: system-managed Barbell links are not deleted by the normal equipment editor; a system bar may be referenced/preferred only if the Barbell profile already linked it to that exercise. Generic create/update/delete/image mutation of managed bars is blocked.
- Added `lib/gym-plate-pools.ts` plus REST routes for listing/creating/updating/deleting custom plate pools. System pools are protected; used pools cannot be deleted. First typecheck exposed two implementation-only issues: shell expansion had stripped `$transaction` once, and refined Zod pool schemas cannot `.omit`; both were fixed explicitly without weakening validation.
- New gym creation now initializes system profiles inside the same DB transaction, so read-only inventory/MCP paths never need hidden initialization.
- Legacy `PUT /api/gyms/:id` is hardened: it rejects direct free-weight-array changes (system-profile writers own those values) and preserves M05/M14 metadata on `GymExerciseConfig` instead of `deleteMany` + recreate. Typecheck remained green after this change.
- Added REST system-profile read + Dumbbells/Barbell write routes. All are ownership-scoped and use the same domain writers.
- MCP inventory now returns read-only `systemProfiles`, `platePools`, structured `loadFacts`, and `systemProfileSupported`; legacy `sharedFreeWeights` remains a compatibility projection only.
- Legacy MCP `update_gym_free_weights` now edits permanent profiles, preserving existing exercise support, SMALL family, known plate quantities, and using `quantity=null` for newly introduced legacy denominations. It no longer does a direct `Gym.update`.
- Added confirmed MCP tools `update_gym_system_profile` and `upsert_gym_plate_pool`. Both re-parse through strict domain schemas after MCP input validation. MCP instructions explicitly prohibit inventing plate counts/load mechanics and require keeping LARGE/SMALL families separate.
- Updated focused MCP mocks to assert the new contract rather than the old direct-update behavior. MCP-focused gate: `lib/mcp/server.test.ts`, `lib/mcp/gym-inventory.test.ts`, `lib/gym-loads.test.ts`, `lib/schemas/gym-equipment.test.ts` = **21/21 passed**.
- Added deterministic legacy bridge: pre-M14 MACHINE/CABLE/OTHER rows with `loadConfigurationKnown=true` and explicit `weightOptions` are backfilled to `SELECTORIZED`; UNKNOWN rows are never promoted. New writes apply the same deterministic mapping and persist the fully validated effective load state.
- Frozen set equipment snapshot upgraded to version 2. It preserves equipment identity/type/manufacturer/model plus explicit UNKNOWN/KNOWN load facts; known facts include load type, displayed loads, multiplier, base load, sides, and an immutable plate-pool snapshot with nullable quantities. Deleting equipment can still clear the FK without erasing these facts.
- Live-session lightweight equipment select now carries structured load facts + plate pool denominations/counts but still excludes image URL/blob fields. M12 program-design active-gym select was similarly narrowed to the needed structured fields rather than loading images.
- Equipment-aware return-to-training now resolves the selected physical equipment through `resolveEquipmentLoadProfile`; plate-loaded equipment uses its exact pool/counts, and UNKNOWN config gets no invented attainable-load scale or ceiling.
- Current combined focused gate after these integrations: session-gym selection + gym loads + return-to-training + MCP inventory/server + equipment schemas = **50/50 passed**; `npm run typecheck` green; `git diff --check` green.
- Added the M14 web settings UI: existing gyms now edit Dumbbells/Barbell through permanent system-profile cards; new gyms still use legacy free-weight arrays only as initial seed data. Generic exercise availability no longer owns DUMBBELL/BARBELL after gym creation. EN/RU/FR strings added. Typecheck and the 50-test focused gate remained green.
- Backup format bumped from v8 to **v9**. Export now includes plate pools/families, nullable plate quantities, structured equipment load facts, pool compatibility keys, system-profile support and preferred equipment. Restore regenerates IDs and relinks by gym/name/compatibility key; v1-v8 remain accepted and are upgraded through the deterministic system-profile initializer.
- Version-9 restore validates duplicate pool names/keys/families, missing referenced pools, UNKNOWN equipment with claimed mechanics, and PLATE_LOADED equipment without a pool before the destructive replacement transaction begins.
- Fresh-schema migration gate passed: all **31 migrations** applied sequentially with `ON_ERROR_STOP=1` to the isolated `gymcoach-web-migration-test-db` on port 5435.
- First pre-M14→M14 backfill verification attempt failed before M14 ran because shell interpolation stripped SQL quotes around `\"User\"`, producing invalid seed SQL (`INSERT INTO User`). A second orchestration attempt also stopped before DB work because the Windows→WSL command layer expanded shell variables to empty values. Both were test-command transport issues only.
- Backfill verification was then rerun with literal SQL files plus Python subprocess orchestration, eliminating shell interpolation. Result: **30 pre-M14 migrations + legacy seed + M14 migration passed**. Verified: exactly one LARGE and one SMALL pool; legacy plate denominations moved only to LARGE with `quantity=NULL`; legacy 20 kg bar became a managed LARGE `PLATE_LOADED` bar; known cable with `[10,20,30]` became `SELECTORIZED`; unknown Hammer remained `loadConfigurationKnown=false`, `loadType=NONE`, empty options; implicit BARBELL support was preserved and the managed bar link was created; an explicitly unavailable DUMBBELL config remained explicitly unsupported.
- Current live worktree HEAD is still `1d80feead6bdd2598a9824875c36170109bfe56f`; all M14 changes remain intentionally uncommitted pending DB/integration/full gates.
- Full unit/component gate after M14: `npm run typecheck` green and **119 test files / 1088 tests passed**. Only pre-existing jsdom accessibility/chart-size warnings were emitted.
- Added dedicated real-DB `tests/integration/gym-system-profiles.test.ts`: read-only no-mutation, rollback on foreign/wrong-type exercise IDs, LARGE/SMALL isolation, nullable plate counts, generic system-member protection, active-session bar protection, and cross-user route ownership/zero-mutation. Current suite is **6/6 passed**.
- The first full integration run reached 343 tests and exposed only stale M14 contract expectations plus the pre-existing Windows/NTFS Unix-mode assertion. M14 issues were fixed by updating backup consumers to v9, history append to snapshot v2, and adding real cross-user coverage for all five new routes; ownership ratchet then passed.
- Progress-photo production code was not weakened: it still calls `writeFile(..., { mode: 0o600 })`. The integration assertion now checks Unix mode bits only on POSIX because Node/NTFS synthesizes `0o666` on Windows and cannot expose POSIX ownership bits. The progress-photo suite is **21/21 passed** on this Windows host.
- Full real-Postgres integration gate is now **46 test files / 344 tests passed** against the isolated migration DB on port 5435. Expected Prisma 404-path logging and the deliberate progress-photo unlink failure test still print diagnostic stderr, but no tests fail.

### Immediate next steps for M14

1. Add focused unit tests for:
   - unknown config produces no inferred attainable loads;
   - finite plate counts limit constructible loads;
   - nullable plate counts preserve uncertainty and usable denominations;
   - load schema rejects `loadConfigurationKnown=false` with claimed mechanics;
   - barbell system profile requires exactly LARGE+SMALL and rejects duplicate bar/plate facts.
2. Run `npm run typecheck` + focused unit tests.
3. Implement `lib/gym-system-profiles.ts` adapted to clean branch:
   - ownership checks;
   - no hidden initialization on read;
   - save Dumbbells profile;
   - save Barbell families/bars/plates;
   - managed bars/pools cannot be mutated/deleted through generic equipment/pool operations;
   - cross-gym/cross-user IDs rejected;
   - active-session selected managed bar cannot be deleted.
4. Extend `lib/gym-equipment.ts` minimally for structured load facts and plate-pool compatibility while preserving current M03/M05/M06 behavior.
5. Add REST routes for system profiles and plate pools where needed.
6. Update MCP inventory/read/write surface:
   - expose system profiles + plate pools;
   - add confirmed system-profile write tool(s);
   - keep current external-AI semantic boundary;
   - do not mutate during read;
   - preserve unknown Hammer facts.
7. Update settings UI with permanent Dumbbells/Barbell profiles. Do not import Android/mobile UI.
8. Update backup/restore version to preserve M14 facts, with validation/trust boundaries.
9. Apply migration to the correct container test DB and run integration tests covering ownership, family isolation, system-member protection, unknown config, migration preservation, MCP confirmation, and zero mutation on rejected writes.
10. Typecheck, full unit suite, integration, production build, then independent semantic audit and separate M14 commit.
11. Update `docs/SHAREN_WEB_MIGRATION.md` M14 to DONE only after all gates pass.
12. Continue M15 final semantic diff/full gate; then the remaining plan sections for Android-specific backend cleanup, Android repo separation, final clean-web gate, main switch, deploy, production health and cleanup.

## Journal maintenance rule for future runs

At the start of every continuation:

1. Read this file.
2. Run `git rev-parse HEAD` + `git status --short` in the canonical worktree.
3. Compare the snapshot here with reality; reality wins.
4. Append/update this journal **before ending the turn**, including failures and unfinished work, not only successful commits.
5. Never claim a test/build/verifier is running unless an actual process/log confirms it.

## 2026-09-06 — M14 exact full-gate portability investigation

- The first exact `scripts/verify.sh --full` attempt completed Prisma generate, lint, typecheck, unit **1088/1088**, and production build, then failed before integration because Windows Git Bash does not provide `flock`. The script treated `flock: command not found` as if another run held the lock, so the printed `still held after 60m` message was misleading; no 60-minute wait actually occurred in that attempt.
- Read-only port/process verification found no listener on `:3031`; `:5434` was owned only by expected Docker Desktop / WSL relay processes. No stale Vitest/Next process was using the shared test infra.
- `scripts/verify.sh` was hardened: use `flock` when available, otherwise use an atomic `mkdir` lock with `trap` cleanup. A historical `/tmp/gymcoach-test-infra.lock.d` directory from 2026-08-30 was discovered; it was not deleted. The new fallback therefore uses a versioned `/tmp/gymcoach-test-infra.lock.portable-v2.d` path so the old stale artifact cannot cause a false wait.
- The first detached retry was invalid before Prisma because Git Bash was launched as a non-login shell from PowerShell and inherited a broken PATH (`dirname` missing, `npx` resolving incorrectly). A probe confirmed `bash.exe -lc` correctly exposes `/usr/bin/dirname`, Node v24.14.0, npm 11.9.0 and npx; the detached runner was changed to use login Git Bash.
- The next valid exact gate reached integration after unit **1088/1088** and a green production build. Integration then failed before Vitest because Windows npm runs lifecycle scripts through `cmd.exe` by default, while `test:integration` begins with POSIX `DATABASE_URL=...` syntax.
- A harmless `npm run env` probe proved that `npm_config_script_shell="D:/Program Files/Git/bin/bash.exe"` makes Windows npm use Git Bash correctly. `scripts/verify.sh` now applies that script-shell only to the full-tier integration/E2E npm invocations. No production code or package dependency was changed for this portability fix.
- PID `27156` is an older detached verify process waiting only on the historical stale `.d` lock path; it is not using Postgres or port 3031. New valid full-gate runs use the versioned portable-v2 lock and do not depend on that stale artifact.
- Immediate next step: rerun one exact `scripts/verify.sh --full` with the updated lock + npm-shell portability fixes; do not run parallel DB/E2E tests while that gate is active.

## 2026-09-06 — M14 final green-gate and completion

- Final exact `scripts/verify.sh --full` completed successfully with exit code 0 at 2026-09-06 12:19:48 +05:00.
- Exact gate evidence on the committed candidate tree: unit/component **119 files / 1088 tests passed**, production build green, integration **46 files / 345 tests passed**, Playwright E2E **18/18 passed**. The only remaining lint warning is the pre-existing unused `extractBlocks` in `lib/import/gpx.ts`.
- Windows full-gate portability was hardened without changing production behavior: `scripts/verify.sh` now falls back to an atomic portable lock when `flock` is unavailable and forces npm lifecycle scripts for integration/E2E through Git Bash; `playwright.config.ts` now passes webServer environment variables through Playwright `env` instead of POSIX inline assignments.
- E2E exposed a real M08/M14 boundary: historical sets recorded without a physical `gymEquipmentId` must not become a load anchor for a newly materialized managed bar. `getReturnToTrainingRecommendationsByEquipment` now uses the latest same-gym exercise date only to establish that the movement has a long break when no comparable equipment history exists; the old non-comparable weights remain excluded. The selected equipment therefore calibrates from its own safe floor. Dedicated real-DB regression **2/2 passed**.
- In the E2E return scenario, the managed 20 kg system bar now correctly produces a conservative 20 kg starting load instead of reusing the old unscoped 40 kg expectation. The AI-set-parse E2E was also updated for the M10 picker-button UI rather than stale numeric-input selectors.
- Full standalone Playwright run after the fixes: **18/18 passed**.
- Final semantic pre-commit audit: `git diff --check` green; no Android/Huawei paths in the working diff; no reintroduction of rejected `599cb2df32714b51f7638c8961e5695b450bd3a2` or dedicated AI proposal/review workflow terms in added lines.
- `docs/SHAREN_WEB_MIGRATION.md` M14 status changed to **DONE** only after the exact full gate passed.
- M14 committed as `fb852a34ef5a8e27fd1a74f454a49cf562c5472d` (`feat(gym): add permanent free-weight system profiles`). `.ai-bridge`, `.gymcoach-interactive-chat.lock`, and `node_modules` remained outside the commit.
- M15 semantic audit started from that HEAD. Legacy `docs/PROJECT_GOALS.md` is authoritative for approved product behavior but is currently absent from the clean branch. Initial confirmed gaps: current thumbnail should open exercise detail and return to the same session/exercise; in-session program controls (planned sets, replace/add/remove, supersets, meaningful notes) are absent; selectable set-table metrics (`1RM` or `10RM`, optionally volume) are absent. Legacy Alpha Progression history was imported by one-off backup scripts rather than a reusable product importer, so it must not be blindly ported with personal backup data. The old `default progress chart to estimated 1RM` change is superseded by current upstream, which renders max load and estimated 1RM simultaneously.
- M15a implemented current-thumbnail detail navigation without copying the legacy menu: clicking a non-current thumbnail still switches exercise, while clicking the current thumbnail opens its canonical exercise detail page. A whitelisted `returnTo` carries the session + `ProgramExercise` id, and the session page restores that exact selected exercise after Back/remount. External/open redirect values are rejected. Verification: `npm run typecheck` green; `session-exercise-strip` + `session-navigation` unit **5/5**; production build green; dedicated Playwright E2E **1/1** passed.

## 2026-09-06 — Hourly continuation policy

- Every hourly ChatGPT continuation must use only the connected `@home-PC` / CodexPro tools for repository inspection, edits, commands, tests, builds, verification, commits and integration. Local Codex CLI, Codex Threads, Project Dispatcher agents and delegated Codex agents remain prohibited.
- At the beginning of every run, inspect the actual branch/HEAD/status/worktrees, active writer/test processes and mutex state, current migration docs/Beads/task artifacts, and already integrated changes before mutating anything.
- Every run must append factual progress to this file: starting state, work completed, blockers/root cause, test/typecheck/build results with counts, commits/integration performed, decisions made, and the exact next incomplete step. Do not rely on chat history alone for handoff continuity.
- The hourly run is an implementation loop, not a status-only watchdog: continue the next incomplete approved migration item, fix blockers where safe, verify it, and make guarded focused commits rather than merely reporting unfinished work.
- Preserve the external-AI-over-MCP architecture and never reintroduce rejected commit `599cb2df32714b51f7638c8961e5695b450bd3a2`, embedded semantic-import LLM proposal pipelines, or dedicated web AI proposal/review screens.
- Never stage local `.ai-bridge`, `.gymcoach-interactive-chat.lock`, `node_modules`, secrets, or personal deployment artifacts.
- Continue through the entire actual migration plan, not only M15: all approved web/backend/MCP parity, final semantic clean audit, applicable Android/mobile-backend separation and repository split, all unit/integration/E2E/typecheck/lint/build/MCP gates, guarded main integration, deployment, production health verification and cleanup that remain required by the authoritative plan.
- The hourly automation may be disabled only after the entire current migration plan is fully integrated and independently verified, the final completion result has been appended to this log, and the user has received a plain-language final report.
- ChatGPT hourly automation `GymCoach Migration` was created and enabled on 2026-09-06. Cadence: once every hour, exact schedule, timezone `Asia/Yekaterinburg`. Its prompt enforces this file-first continuation policy, `@home-PC`/CodexPro-only execution, full-plan completion rather than status-only reporting, and self-disabling only after the complete plan has been integrated and verified.

## 2026-09-06 — M15b in-session program controls

- Starting state: canonical migration worktree HEAD `53e4d2ae91cd1d404e2c595e9aa45e9a56ae1715` on `migration/web-upstream-clean`; stale `interactive-chat` lock was older than 90 minutes and no matching GymCoach writer/test process was active. The worktree already contained a partial uncommitted M15b implementation: a superset action route, its integration coverage, a not-yet-rendered `SessionExerciseActions` component, and the hourly-policy journal entry.
- Git metadata note: the copied CodexPro worktree's `.git` pointer resolves poorly through the current shell bridge, but the authoritative worktree metadata still exists under the original GymCoach repository. Git status/diff/commit operations in this run therefore use the explicit authoritative `--git-dir` plus the current `--work-tree`; no repository history was recreated or rewritten.
- Completed M15b wiring: the active session now renders an exercise-actions menu in input mode. It can edit planned targets, replace an exercise from the same primary-muscle catalog, add an unused exercise, create/join/break a superset through an atomic ownership-scoped route, and remove an unstarted exercise. EN/RU/FR strings were added.
- Safety behavior: once any set for the current exercise has been logged, replacement is constrained to the same exercise and removal is disabled, so historical session sets cannot silently become attached to a newly selected programmed exercise. The session runner is keyed by the current ProgramExercise id list so removing the last-position exercise cannot leave a stale out-of-range client index after refresh.
- Focused verification: `npm run typecheck` green; session navigation/strip unit tests **5/5 passed**; real-Postgres `tests/integration/superset-route.test.ts` **6/6 passed** (run through login Git Bash because Windows npm otherwise interprets the POSIX `DATABASE_URL=...` lifecycle prefix via `cmd.exe`); dedicated Chromium `tests/e2e/session-exercise-actions.spec.ts` **1/1 passed** and verified editing planned set count plus linking and breaking a superset without leaving the runner.
- Production verification: `npm run build` green. Only the pre-existing `lib/import/gpx.ts` unused `extractBlocks` lint warning remains. `git diff --check` green.
- Architecture audit: no Android/Huawei/mobile-client code was introduced and no rejected embedded semantic-AI proposal/review path was added; this batch is deterministic workout/session control only.
- Implementation commit: `627ba48` (`feat(session): add in-session program controls`). Local `.ai-bridge`, `.gymcoach-interactive-chat.lock`, and `node_modules` remained unstaged.
- Exact next incomplete item: continue M15 semantic parity with selectable set-table metric views from `PROJECT_GOALS.md` — `1RM + volume` or `10RM + volume`, never 1RM and 10RM together — while confirming current-upstream equivalents before porting anything else.


## 2026-09-06 — M15c selectable set-table metrics

- Starting state: canonical migration worktree was migration/web-upstream-clean at 06e1444925e653b5ca976b1d80e7757d36a2b869; only local .ai-bridge/, .gymcoach-interactive-chat.lock, and node_modules were untracked. Both interactive-chat mutex files were older than 90 minutes. Read-only process inspection found no active writer/test/verify process for this migration worktree, so the current interactive-chat owner safely refreshed the two mutex mtimes before mutation.
- Authoritative legacy docs were re-read from the original GymCoach checkout. PROJECT_GOALS.md confirms the approved metric requirement: users may choose 1RM + volume or 10RM + volume, with 1RM and 10RM mutually exclusive. SHAREN_WEB_MIGRATION_PLAN.md confirms Android-backend cleanup, Android repository separation, final clean-web gates, main integration, deployment, production health and cleanup remain later required stages.
- Current/upstream comparison: the clean branch already had Epley estimate1RM, completed-set editing and separate active-set input, but no selectable set metrics. Only the deterministic local preference/domain behavior was adapted from legacy; no embedded AI proposal/review flow or mobile code was copied.
- Implemented locally persisted strength-set metrics 1RM, 10RM and VOLUME; existing gymcoach.prefs.v1 data remains backward compatible through the legacy rmDisplay fallback. Selecting 1RM or 10RM replaces the other while preserving optional volume. Preference changes are synchronised between the completed-sets list and active set input through a local browser event.
- Added estimateRepMax to the shared stats domain using the existing Epley 1RM estimate and its inverse for 10RM. Completed strength sets display the selected metric values and the active draft updates the same metrics before confirmation. Cardio rows are excluded. EN/RU/FR labels were added.
- Tooling blocker encountered and resolved: the shell bridge interpreted JavaScript template-literal expressions during the first JSX patch, leaving two empty data-testid attributes and one empty dynamic className. No DB or persisted user data was touched. Direct inspection found exactly those three malformed locations; they were replaced with equivalent non-shell-expanded JSX, formatted and typechecked successfully. A later attempt to append this Markdown journal through shell heredoc was also rejected by the same bridge because Markdown backticks were treated as commands; inspection confirmed no partial journal block was written, so this entry was recorded without shell backticks.
- Regression coverage: preference migration/mutual exclusion, 1RM/10RM calculation, completed-row metric switching and active-draft metrics. Focused Vitest gate: 4 files / 102 tests passed. npm run typecheck green. git diff --check green.
- Production build green. The only lint warning remains the pre-existing unused extractBlocks in lib/import/gpx.ts.
- Independent direct verification: Chromium E2E tests/e2e/session-set-metrics.spec.ts registered a user, created a strength session, entered 100x10, verified active 1RM 133.3, enabled volume 1000, switched to 10RM 100 with 1RM absent, reloaded, and verified persisted 10RM + Vol. selection. Result: 1/1 passed.
- Architecture/scope audit before commit: no Android/Huawei/mobile paths, rejected commit reference, semantic-import proposal pipeline, or dedicated AI proposal/review UI appeared in the implementation diff. .ai-bridge, lock files and node_modules were explicitly excluded from staging.
- Implementation committed as ba06d2a (feat(session): add selectable set metrics).
- Exact next incomplete step: continue the M15 semantic clean audit against PROJECT_GOALS.md and current upstream, starting with remaining fast-session requirements (prior workout/history/progress access, recommendation application behavior, meaningful-note presentation) and classify each as already equivalent, intentionally superseded or a real parity gap before porting anything else.


## 2026-09-06 — M15d equipment-scoped prior workout and history links

- Starting state: migration/web-upstream-clean at 541e384dab1223794f80beba6d7ee9dd89ee16ab. Only local .ai-bridge/, .gymcoach-interactive-chat.lock and node_modules were untracked. The interactive-chat lock belonged to this run and no migration writer/test process was active.
- M15 audit classified the PROJECT_GOALS fast-session requirement for the prior workout as a real parity gap, not an upstream equivalent. The clean branch showed only one generic last performance per exercise. M08 return-to-training was already equipment-aware, but ordinary previous-performance prefill, intra-set progression and PR baseline could still mix two physical machines for the same exercise.
- Server history was hardened around deterministic identity only. LastPerformance now carries factual session id, gym id, equipment id and frozen equipment name. buildEquipmentPerformanceTargets emits one target per linked physical equipment, or one null-equipment target when no equipment is linked. getLastPerformancesForEquipmentTargets resolves every target independently, so a newer Machine B does not hide an older Machine A. Queries remain user-owned, gym-scoped and equipment-scoped. No semantic inference was added.
- The session page now serializes an array of prior performances per exercise. The client selects the prior performance matching the currently selected equipment. Current-session sets used for next-set calculations and active-draft prefill are filtered to the same equipment identity, so load history from another physical machine is not treated as directly comparable. The post-session PR baseline uses the selected equipment history as well.
- Added PreviousSessionSets below the current set-entry area. It shows the selected equipment name and the previous working sets, links directly to the exact previous workout history page, and links to the progress page filtered by the current exercise. EN/RU/FR labels were added.
- Unit/component coverage: added pure target-building and machine-isolation tests, runner equipment identity/filter/selection tests, and previous-session rendering/link tests. Final focused gate was 5 files / 43 tests passed. npm run typecheck green. git diff --check green.
- Real PostgreSQL integration: tests/integration/last-performance.test.ts now proves that an older Machine A performance remains independently retrievable after a newer Machine B workout and that another gym cannot contaminate either target. Final focused integration result: 1 file / 6 tests passed on the shared test database.
- Integration test runner blockers and root causes: a direct Windows npx invocation dropped DATABASE_URL before Vitest and produced 0 tests; a second npm_config_script_shell attempt was still interpreted by cmd.exe. No application code ran in either failed attempt. The focused integration was then run with DATABASE_URL set explicitly inside cmd.exe and passed 6/6.
- Production build green after M15d. The only lint warning remains the pre-existing unused extractBlocks in lib/import/gpx.ts.
- Browser verification blockers and root causes were test transport only. First direct playwright.cmd invocation did not inherit npm node_modules PATH, so its webServer could not find next. Running through npm fixed webServer startup. The first real E2E seed then failed because the Home-PC shell bridge had stripped PostgreSQL dollar placeholders from SQL strings while the test file was generated. Those placeholders were restored without changing product code. The next run reached the correct Machine A page but used an ambiguous 70 kg text locator. A previous-session test id was added to scope the assertion. One intermediate rerun used the old production bundle before rebuilding and typecheck also caught two optional seed array accesses. After fixing the test typing and rebuilding, the exact browser scenario passed.
- Independent Chromium E2E result: 1/1 passed. It created Press A and Press B for the same exercise, made A the preferred machine, seeded older A at 70 kg and newer B at 110 kg, opened a new session, verified the previous-workout block showed Press A / 70 kg and the exact A history link, switched the equipment selector to Press B, then verified the block changed to Press B / 110 kg and the exact B history link.
- Scope audit before commit: no Android/Huawei/mobile paths, rejected commit 599cb2df32714b51f7638c8961e5695b450bd3a2, semantic-import proposal pipeline, or dedicated AI proposal/review UI appeared in the staged diff. .ai-bridge, lock files and node_modules remained unstaged.
- Implementation committed as 055f87c (feat(session): scope history to selected equipment).
- Exact next incomplete step: continue the M15 semantic audit with the PROJECT_GOALS recommendation-application requirement and meaningful-note presentation. Determine whether current SetInput already restores recommendations after manual edits and whether program/exercise notes shown in-session exceed the compact-session requirement; implement only confirmed gaps, then repeat focused verification and journaling.


## 2026-09-06 — M15e explicit recommendations and compact meaningful session notes

- Starting state: migration/web-upstream-clean at 35d650bac37a1ceb5553978662e9b4abd7e368d5. Only local .ai-bridge, .gymcoach-interactive-chat.lock and node_modules were untracked. Worktree inspection found no active migration writer, Vitest, Playwright or verify process. The original legacy checkout and unrelated historical worktrees remained untouched. No Beads/task artifact was present in the clean worktree.
- Authoritative PROJECT_GOALS comparison confirmed two real parity gaps. Current SetInput automatically replaced the next draft with the intra-set recommendation, while the approved behavior requires an explicit apply action that becomes available again after a relevant manual edit. The live ExerciseCard also duplicated technique notes, muscle/category information and a small prior-history summary even though approved session UX keeps technique, muscles and history on the exercise detail/history surfaces and shows only meaningful athlete/coach notes.
- Recommendation behavior changed without changing the deterministic recommendation algorithm. A completed set now seeds the next draft from the actual previous set. The recommendation is displayed separately and Apply recommendation copies weight, reps and RIR only on explicit user action. The action disables while the draft exactly matches the recommendation and automatically becomes available again after weight/reps/RIR are changed manually. Return-to-training first-set calibration and ordinary first-set progression remain unchanged. EN/RU/FR apply labels were added.
- Added deterministic meaningfulProgramNote filtering from the approved legacy behavior. Import metadata and prescription-only lines are hidden while genuine user/coach cues survive. No LLM or semantic inference was introduced; ambiguous semantic understanding remains external-AI-over-MCP.
- ExerciseCard was reduced for live-session use: compact horizontally scrollable title, current gym/unavailable context retained, muscle/category badges removed, exercise technique/media removed, and duplicate last-session history removed because the dedicated previous-workout block now owns history. Program notes render only after meaningfulProgramNote filtering. Existing first-set suggestion/readiness explanation remains because it directly affects the live workout.
- A focused test initially exposed one real implementation bug: the card correctly decided visibility from the filtered note but still rendered raw ProgramExercise.notes after expansion. This was fixed so the displayed text is the filtered value itself. Final focused gate: 3 files / 35 tests passed; npm run typecheck green; git diff --check green.
- Production build green. The only lint warning is the pre-existing unused extractBlocks in lib/import/gpx.ts. A temporary earlier build attempt timed out after compilation because the new E2E seed contained an invalid multiline single-quoted string and also revealed an obsolete computeInitial recommendation parameter; the test seed was rewritten with a deterministic newline join and the unused parameter removed. No production state or DB mutation was involved in that failed build command.
- Independent Chromium verification: 1/1 passed. It verified that an exercise technique note and Quadriceps label are absent from the live card, only the meaningful program cue remains after filtering importer metadata, the first logged 100x12 set leaves the next draft at 12 reps, Apply recommendation is enabled, applying changes the draft to the deterministic recommendation, a manual +1 rep re-enables Apply, and applying again disables it after restoring the recommendation.
- Scope audit before commit: no Android/Huawei/mobile paths, rejected commit 599cb2df32714b51f7638c8961e5695b450bd3a2, semantic-import proposal pipeline or dedicated AI proposal/review UI appeared in the staged diff. .ai-bridge, local lock and node_modules remained unstaged.
- Implementation committed as 8f027c8 (feat(session): make recommendations explicit).
- Next confirmed M15 gap: the live strength workflow still separates completed SetsList from a large SetInput form. PROJECT_GOALS requires weight/reps/RIR entry directly in the set table with confirmation only on the current working row, and legacy EditableSetsTable also provided explicit undo of the last completed set. Current SetsList has placeholder planned rows and completed-set editing, but the active row is not editable and current session actions do not provide undo. Exact next step: compare the current SetsList/SetInput contracts with legacy EditableSetsTable, implement only the missing active-row/confirmation and undo behavior while preserving current sync/equipment/recommendation logic, then run focused tests, typecheck, build and independent E2E.


## 2026-09-06 — M15f active set row and undo

- Starting state: migration/web-upstream-clean at 54e659a8261fd4e3131d4c282b37c915a016610e with only local .ai-bridge, .gymcoach-interactive-chat.lock and node_modules untracked. No relevant writer/test process was active.
- PROJECT_GOALS comparison confirmed that the current upstream-derived runner still split completed SetsList rows from a separate large SetInput card, while the approved fast-session workflow requires weight/reps/RIR entry and the confirmation control to live in the current working row. Legacy EditableSetsTable also exposed undo-last-set, which the current session actions did not.
- The legacy EditableSetsTable was not copied wholesale because it mixes old inventory/UI responsibilities already superseded by the clean branch. Instead, the existing SetInput remains the single implementation of quick entry, AI parse fill, notes, warmup/drop-set toggles, equipment selection, load constraints, metrics and recommendation application, but it now supports a neutral embedded layout.
- SetsList now accepts the current input as content for the active planned row. The row is marked current, owns the confirmation UI through the embedded SetInput, and future rows remain compact placeholders. There is no second SetInput card below the table. Completed-set inline editing remains unchanged and still saves directly.
- Added explicit Undo last set above completed rows. SessionRunner wires it to the actual last current-exercise PendingSet and reuses the existing handleDeleteSet path, so synced rows use the existing server DELETE before local removal and unsynced rows remain local-only. No new persistence path was introduced. EN/RU/FR labels were added.
- Two initial SetsList patch attempts were stopped before writing because the Home-PC shell bridge interpreted a JSX template literal in the patch command. The successful patch avoided shell-visible template literals. No DB or product data was touched.
- Focused verification: SetsList + SetInput = 2 files / 27 tests passed. New regressions prove the current control is rendered inside data-testid current-set-row and undo calls the provided latest-set action. npm run typecheck green and git diff --check green.
- A first production-build command hit the Home-PC 30-second tool timeout after successful compilation/lint/typecheck. The same build was rerun with a 120-second command timeout and completed green. The only lint warning remains the pre-existing unused extractBlocks in lib/import/gpx.ts.
- Independent Chromium E2E: 1/1 passed. The existing recommendation/notes scenario now additionally verifies Quick entry and Log the set are inside the current table row, then logs a set, verifies recommendation apply/reapply, uses Undo last set, and confirms the table returns to Set 1 · in progress with no remaining undo action.
- Scope audit before commit: no Android/Huawei/mobile paths, rejected commit 599cb2df32714b51f7638c8961e5695b450bd3a2, semantic-import proposal pipeline or dedicated AI proposal/review UI appeared in the staged diff. .ai-bridge, local lock and node_modules remained unstaged.
- Implementation committed as 052219e (feat(session): move active set into table).
- Exact next incomplete step: continue the M15 semantic clean audit against PROJECT_GOALS and current clean branch. First inspect the remaining gym/session UX requirement for a custom weight picker with real available-weight tape and right-side barbell plate diagram, plus any remaining approved localization/detail/history behavior. Classify each as already equivalent, intentionally superseded or a real parity gap before writing code. After semantic parity is exhausted, run the full M15 gate and then proceed to Android-specific backend cleanup and repository separation from the migration plan.


## 2026-09-06 — M15f active set row and undo parity

- Starting state for this continuation: migration/web-upstream-clean at 54e659a8261fd4e3131d4c282b37c915a016610e. M15e was already committed and journaled by the hourly continuation. The worktree contained a partial uncommitted next-step implementation in session-runner, SetInput, SetsList, translations and the recommendation/notes E2E. Local .ai-bridge, .gymcoach-interactive-chat.lock and node_modules remained untracked. No active migration writer, Vitest, Playwright or verify process was running.
- The partial implementation was reviewed against the authoritative legacy EditableSetsTable instead of being committed as-is. The first version merely embedded the old large SetInput card inside a SetsList row. Legacy parity requires the current working row itself to expose load, repetitions, RIR, calculated metrics and the single confirmation control.
- SetInput now has a strength-only embedded mode used by the live session row. The compact row exposes load picker, repetitions picker, RIR selector and confirm control directly. Current calculated metrics remain attached to the active row. The deterministic recommendation remains visible and explicit; manual changes still make Apply recommendation available again. Machine selection remains visible when relevant. Less-frequent quick entry, optional AI parse, warmup/drop toggles, plate/warmup calculators and the per-set note are preserved under a compact More set options disclosure rather than removed. Cardio keeps the existing specialized full input.
- SetsList now renders the embedded current input only for a remaining planned working set and offers explicit Undo last set only in input mode. Undo deletes the latest real current-exercise set through the existing durable/server-aware delete path; it does not introduce a parallel persistence mechanism.
- A row-count bug found during the parity review was fixed: warmup rows no longer reduce the number of planned working rows, because remaining rows are computed from non-warmup completion count. Conversely, when all planned working sets are complete, SetsList no longer manufactures an extra active row. Additional work therefore requires an explicit planned-set-count increase, matching the approved session controls.
- Focused coverage was expanded for the compact embedded controls, warmup-vs-working-row accounting, no-extra-row-after-plan completion and hiding undo during rest. Final focused result: 4 files / 45 tests passed. npm run typecheck green. git diff --check green.
- Production build green. The only lint warning remains the pre-existing unused extractBlocks in lib/import/gpx.ts.
- Independent Chromium verification: tests/e2e/session-recommendation-notes.spec.ts passed 1/1. It verified that load, reps, RIR and confirmation are directly in the current set row; More set options reveals quick entry; meaningful-note filtering remains intact; after logging a first set the deterministic recommendation is explicit, applying it updates the row, editing reps through the row picker re-enables Apply, reapplying disables it again, and Undo last set removes the logged row and returns the workout to Set 1 in progress.
- Tooling blocker: while generating the compact JSX through the Home-PC shell bridge, a template-expression translation key was interpreted by the shell and temporarily became an empty autoT call. Inspection caught the exact single damaged expression before commit. It was replaced with a typed static reason-key map, avoiding shell interpolation entirely. No database or persisted user data was touched by this tooling error.
- Scope audit before commit: git diff --check green; no Android, Huawei, mobile-backend paths, rejected commit 599cb2df32714b51f7638c8961e5695b450bd3a2, semantic-import proposal pipeline or dedicated AI proposal/review UI appeared in the staged changes. Local .ai-bridge, lock and node_modules remained unstaged.
- Implementation commit: b0fd9ba926517530d3555b40015de2ff70320878 (feat(session): edit active set in table).
- Exact next incomplete step: continue the M15 final semantic diff audit across the remaining PROJECT_GOALS requirements, starting with accurate gym/equipment controls that may still differ from the legacy approved live-session UX: explicit available-weight editing scope and the right-side barbell load diagram. Classify each requirement as already covered by M10/M14/current upstream, intentionally superseded, or a real gap before porting anything. Then finish the remaining non-Android semantic audit and run the full M15 gate.


## 2026-09-06 — M15g exercise-detail history parity

- Starting state: migration/web-upstream-clean at b5e95ce6a233edb84cf1f8ab20b626455d7ab06b after M15f. Only local .ai-bridge/, .gymcoach-interactive-chat.lock and node_modules were untracked.
- Final PROJECT_GOALS audit found one genuine detail-page gap. M15e correctly removed duplicated technique, muscle and history material from the live session card, but the clean exercise detail page only contained technique media, muscle/category/equipment badges, notes and physical-equipment editing. It did not yet provide the exercise training history or a direct progress-chart path that the approved compact-session architecture expects to live outside the runner.
- Restored a bounded exercise-history section on the detail page without importing the legacy equipment-editor implementation. The page now loads only owned non-warmup sets, groups the most recent 100 rows into at most 12 sessions, links every history group to the exact workout, and links the exercise to /progress filtered by exerciseId. Strength rows show stored weight, repetitions, RIR and the frozen equipment-name snapshot when available. Cardio rows show recorded duration and distance. No new training calculation or semantic inference was introduced.
- EN/RU/FR detail translations were added for history/chart/session/reps/equipment labels. Existing technique media and current M14 exercise-to-equipment editor remain the authoritative detail surfaces for those domains.
- Verification: npm run typecheck green; npm run build green (only the pre-existing unused extractBlocks warning in lib/import/gpx.ts); git diff --check green. Chromium tests/e2e/session-exercise-detail-navigation.spec.ts passed 1/1 after seeding a historical 60 kg x 8 @ RIR 2 set, opening the current exercise detail from the session thumbnail, verifying the history values and exact workout/progress links, then returning to the same session/program exercise.
- The first E2E attempt reached the correct history UI but used an ambiguous text locator for RIR 2 because the date also contained the digit. The assertion was narrowed to the exact table cell; product code did not change for this test-only issue. A previous combined build+E2E command was terminated by the requested 30-second CodexPro command timeout after successful compilation but before build completion; rerunning with a 180-second command timeout completed the green build and test.
- Alpha Progression classification was rechecked directly in the tracked legacy repository. There is no reusable Alpha Progression importer or parser to port: tracked legacy references are only existing-account translation/media aliases and note filtering for data that had already been imported. Therefore the PROJECT_GOALS Alpha history item is a production-data preservation/cutover requirement for this migration, not a missing reusable web feature. The existing production DB must be migrated and verified later; personal one-off backup/import material must not be added to the clean product repository.
- Scope audit before commit: no Android/Huawei/mobile paths, rejected commit 599cb2df32714b51f7638c8961e5695b450bd3a2, semantic-import proposal pipeline or dedicated AI proposal/review UI were introduced. Local .ai-bridge, lock and node_modules remained unstaged.
- Implementation commit: 53c5c48141d4f415374dce2280306a5e1727e131 (feat(exercises): restore detail training history).
- Exact next incomplete step: finish the remaining M15 classification-only semantic audit. Confirm current SetValuePicker/M14 gym profiles cover the real-weight tape, explicit confirmation, barbell-side diagram and editable free-weight inventory; confirm coaching risk signals, structured program-design context, codex-lb/provider abstraction, MCP read/write/revision contracts, localization and licensed media are already covered. Record any intentional supersessions (including Alpha as data migration). If no further real web gap remains, run the full M15 verification gate and only then begin migration-plan stage 13 Android/mobile-backend cleanup.


## 2026-09-06 — M15h final semantic classification before full gate

- Starting state: migration/web-upstream-clean at fbbe3395517a01bb89dec30e879eece353fecbaf after M15g, with only local .ai-bridge/, .gymcoach-interactive-chat.lock and node_modules untracked. No Beads/task database is present in the clean worktree; the migration docs and this journal remain the authoritative task state.
- Remaining PROJECT_GOALS requirements were classified against current code and prior M01-M14 behavior before writing any more product code. No additional approved non-Android behavior gap was found.
- Gym/load UX is already covered and the old live WeightInventoryEditor must not be re-ported: SetValuePicker provides the saved/available-weight tape, on-screen keypad, explicit Apply value confirmation and a barbell-side diagram using the current load constraints. M14 permanent Dumbbells/Barbell profiles edit arbitrary dumbbell weights, concrete bars, plate denominations/quantities, loading sides and exercise link scope per gym. Physical selectorized/plate-loaded equipment and per-exercise preferred equipment are handled by the current M03/M05/M06/M14 domain.
- Coaching/recovery behavior is already covered without inventing opaque physiology scores: intra-set autoregulation uses bounded modes/coefficient inputs, actual rest and same-muscle superset context; coach fatigue derives stalled lifts and deload reasons from recorded performance plus recent readiness; current/previous week and structured readiness/fatigue signals are exposed to program-design context so the external agent can explain workload/recovery changes. No catabolism/CNS/medical-diagnosis score is introduced.
- Program design is already a shared structured contract: get_program_design_context includes source program, structured coaching profile, active-gym equipment, exercise load profiles, current/previous training, readiness, fatigue, records, return-to-training and explicit data-quality confidence. validate_program_draft is deterministic. Revision lineage/provenance is stored through create_program_revision. This satisfies the rule that validated facts/confidence feed design rather than relying on raw chat memory.
- Provider/MCP requirements are already covered: lib/llm is provider-agnostic and includes Anthropic, OpenRouter, demo and an OpenAI Responses-compatible codex-lb provider configurable by base URL/key. MCP advertises exact training/gym/history/catalog/program context plus confirmed inventory writes, safe canonical exercise/equipment reuse, equipment binding, workout import/update, program validation/creation/revision/edit/activation. GYMCOACH_MCP_INSTRUCTIONS explicitly assigns free-text/name/photo/inventory/program reasoning to the external MCP agent and write schemas carry explicit confirmation. No dedicated web AI proposal/review screen is required or desired.
- Localization/exercise information is covered: EN/RU remain first-class, FR demonstrates an additional language without moving translations into business logic; Russian exercise-name aliases are maintained; technique media is source/license annotated; M15g now keeps technique, target muscle/category, equipment and recent history/progress on the exercise detail surface rather than duplicating them in the live runner.
- Alpha Progression and the initial personal Olimp profile are classified as persisted-account/cutover data, not hard-coded reusable product defaults. Legacy tracked code contains no general Alpha importer. Existing production facts must survive the production-DB migration and be verified during cutover; personal backup scripts/data must not be committed into the clean fork.
- Focused classification verification: 15 test files / 86 tests passed covering SetValuePicker, gym load constraints, deload/recovery signaling, coach context, structured coaching/load-profile schemas, program-design validation, codex-lb/provider selection, MCP tool/instruction contracts, exercise-name aliases and licensed technique media.
- Intentional supersessions: do not re-port the legacy live WeightInventoryEditor because M14/settings + current picker provide the same facts with cleaner ownership; do not create a product Alpha importer from nonexistent one-off legacy code; do not restore embedded semantic AI proposal/review; do not replace current upstream progress dashboard with the old single-metric default because current progress provides richer simultaneous views while the live set-table preference is separately handled by M15c.
- Semantic conclusion: M15 product parity is exhausted. The next incomplete step is the exact full green gate on the committed candidate. Only after unit/integration/E2E/typecheck/lint/build/MCP checks are green may docs/SHAREN_WEB_MIGRATION.md mark M15 DONE and migration-plan stage 13 Android/mobile-backend cleanup begin.
