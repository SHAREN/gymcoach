# Upstream sync checkpoint - 2026-08-22

This document is the restart point for the GymCoach upstream-sync work. Read it before continuing this task in a new ChatGPT thread.

## Current Git state

- Upstream: `https://github.com/Julien-Au/gymcoach`
- Fork: `https://github.com/SHAREN/gymcoach.git`
- Working sync branch: `sync/upstream-20260822`
- Current HEAD at the checkpoint: `558a16b feat: add in-session set controls`
- Relative to the fetched `upstream/main`: 31 commits ahead, 0 behind.
- Safety branch created before rewriting history: `backup/pre-upstream-sync-20260822`.
- The original local post-commit work is also still preserved in `stash@{0}` as `pre-upstream-sync local history and create-gym`. The stash was kept after a conflicted pop; do not drop it until the final reconciled tree is committed and verified.
- Production was NOT redeployed during this sync work.
- Production database was NOT modified during the investigation.

## What was done to sync upstream

A direct merge produced many false conflicts because upstream had already accepted several SHAREN contributions under different commit hashes. Instead, the branch was rebuilt on top of current `upstream/main`, replaying only the locally unique commits.

The rebase completed successfully. Source-code conflicts were resolved by preserving both the upstream behavior and the local additions rather than taking one side wholesale. In particular:

- upstream backup-import normalization was preserved;
- local per-exercise gym weight overrides were preserved;
- local physical gym-equipment/MCP inventory was preserved;
- upstream progress-photo support was preserved;
- local Android/mobile API support was preserved;
- local `create_gym` work was restored afterward;
- local history-calendar work was restored afterward.

There are currently no unresolved Git conflict markers.

## Verification already completed

On the reconciled source tree:

- TypeScript typecheck passes.
- Linux unit suite passes: 114 test files, 1022 tests.
- Linux production `next build` passes.
- `lib/progress-photo.test.ts` passes 18/18 in Linux.

A real cross-platform bug found during verification was fixed: a stored progress-photo relative path used the Windows separator (`user\\photo.png`). It now uses a stable POSIX-style relative path (`user/photo.png`).

Two progress-photo permission assertions fail when the test suite is run with Windows Node because Windows does not expose POSIX `0600/0700` mode bits in the same way. The same tests pass in Linux, which is the production/container environment. The tests were not weakened.

## The migration problem in plain language

The main problem is not that the data in production is corrupt. The problem is that the same database changes now appear under different dates/names, and their order is wrong after combining our history with upstream.

### Concrete example: gyms

The production database ALREADY has these tables:

- `Gym`
- `GymExerciseConfig`

The production `GymExerciseConfig` table already has, among other fields:

- `weightOptions`
- `dumbbellWeights`
- `plateWeights`
- `barWeights`
- `isEquipmentMirror`
- `preferredEquipmentId`
- `systemProfileSupported`

Our old migration history created `Gym` and `GymExerciseConfig` on `20260711150000_add_gym_profiles`.

A later local migration, `20260713130000_add_gym_exercise_weight_overrides`, then added the three per-exercise arrays:

- `dumbbellWeights`
- `plateWeights`
- `barWeights`

Upstream accepted the original gym-profiles feature, but in upstream history the table-creation migration has a NEW name/date:

- `20260722161000_add_gym_profiles`

After rebasing, a brand-new empty database sees the migrations in date order like this:

1. `20260713130000_add_gym_exercise_weight_overrides` - tries to add columns to `GymExerciseConfig`.
2. `20260722161000_add_gym_profiles` - only later tries to create `GymExerciseConfig`.

So step 1 fails with the simple meaning: **"add columns to the gym-exercise table" is being run before that table exists.**

This was reproduced on a completely fresh test PostgreSQL database. PostgreSQL returned: `relation "GymExerciseConfig" does not exist`.

### Why production has the opposite problem

Production is different from a fresh database. It already ran the OLD migration:

- `20260711150000_add_gym_profiles`

Therefore the `Gym` and `GymExerciseConfig` tables already exist there.

But the current rebased repository contains the upstream migration under the NEW name:

- `20260722161000_add_gym_profiles`

Prisma tracks migrations by migration name. Production has never seen that new name, so it would consider it not applied and would try to run it. That new migration tries to create `Gym`, `GymExerciseConfig`, the `EquipmentType` enum, and related columns/indexes again.

In plain language: **production already has the cupboard, but the new migration thinks the cupboard has never been built and tries to build another cupboard with the same name.** PostgreSQL would reject the duplicate table/type/column.

### The same duplicate-history issue exists for two other accepted features

Autoregulation:

- production already ran `20260711033000_add_intra_set_autoregulation`;
- upstream now carries the accepted feature as `20260722160000_add_intra_set_autoregulation`.

The database already has the autoregulation enum and the `ProgramExercise` fields. Running the upstream-named copy again would try to add the same things again.

MCP tokens:

- production already ran `20260711210000_add_mcp_access_tokens`;
- upstream now carries it as `20260722162000_add_mcp_access_tokens`.

The production database already has the `McpAccessToken` table. The upstream-named copy would try to create the same table again.

### A genuinely new upstream migration is different

`20260722100000_add_progress_photo` is actually new for our production database. Production currently does NOT have a `ProgressPhoto` table. That migration should remain real and should run normally when we eventually deploy the reconciled version.

## A second database-history issue: production is ahead of the rebased repository

The live production database and live container contain additional local migrations that are currently missing from the rebased repository. These are not merely different names for upstream work. They add real local features that production already uses.

Missing from the current repository but already applied in production:

- `20260713230000_fix_close_grip_cable_row_classification`
- `20260714000000_fix_confirmed_leg_curl_classification`
- `20260715120000_equipment_first_load_domain`
- `20260715150000_add_mobile_equipment_snapshot_revisions`
- `20260715170000_preserve_session_exercise_membership`
- `20260715193000_preserve_equipment_mirror_and_session_order`
- `20260716123000_add_preferred_gym_equipment`
- `20260718030000_add_system_free_weight_profiles`
- `20260718100000_add_structured_coaching_profile`
- `20260718120000_add_exercise_load_profiles`
- `20260720120000_redact_coach_session_prompts`

The exact `migration.sql` files still exist inside the running `gymcoach-app` container and can be restored byte-for-byte from `/app/prisma/migrations/...`. Do not recreate them from memory.

### What those production-only migrations mean in ordinary terms

1. Two migrations correct wrongly classified exercises in existing data:
   - a close-grip cable row that had been classified as triceps is corrected to back thickness;
   - two leg-curl rows that had been classified as biceps are corrected to hamstrings.

2. Equipment-first gym inventory adds a more precise model of gym equipment:
   - each gym gets an inventory mode;
   - plate pools and plate quantities can be stored;
   - a machine/bar can describe how its load is selected;
   - a set can remember exactly which physical machine/bar was used and snapshot its resistance data.

   Production therefore contains tables/fields that the current rebased `prisma/schema.prisma` does not currently describe, including `GymPlatePool`, `GymPlateInventoryItem`, and additional `GymEquipment`/`Set` fields.

3. Android/offline support adds `MobileEquipmentSnapshotRevision`, which preserves the exact machine configuration that an Android workout saw while offline.

4. Session exercise membership adds a `SessionExercise` table so an exercise remains part of a workout session even if its sets are later edited/deleted, and later adds a stable exercise order (`ordinal`).

5. Gym equipment mirror/preference support adds:
   - `GymExerciseConfig.isEquipmentMirror`;
   - `GymEquipmentExercise.mirrorsLegacyConfig`;
   - `GymExerciseConfig.preferredEquipmentId`.

6. System free-weight profiles add support for large/small barbell diameter families and `GymExerciseConfig.systemProfileSupported`.

7. Structured coaching profile adds to `User`:
   - `coachingProfile`;
   - `coachingProfileUpdatedAt`.

8. Exercise load profiles add to `Exercise`:
   - `catalogOrigin`;
   - `loadProfile` JSON describing more detailed muscle/movement/fatigue/joint-load information.

9. The coach prompt redaction migration replaces old stored `CoachSession.prompt` payloads with non-sensitive audit metadata. It changes existing data, not the table shape.

Important consequence: if the rebased branch were deployed now, PostgreSQL would not automatically delete those extra production columns, but the new generated application client does not know about many of them. In simple terms: **the data would still physically be in PostgreSQL, but the new application version would forget that those fields/features exist.** Therefore the sync branch must NOT be deployed until these migrations and matching schema/code are restored or deliberately retired.

## Production migration list observed on 2026-08-22

The production `_prisma_migrations` table shows the following local-history tail as already applied:

- `20260711033000_add_intra_set_autoregulation`
- `20260711150000_add_gym_profiles`
- `20260711210000_add_mcp_access_tokens`
- `20260712180000_add_target_drop_sets`
- `20260713120000_add_program_revision_lineage`
- `20260713130000_add_gym_exercise_weight_overrides`
- `20260713140000_add_gym_equipment_inventory`
- `20260713220000_add_mobile_offline_sync`
- `20260713230000_fix_close_grip_cable_row_classification`
- `20260714000000_fix_confirmed_leg_curl_classification`
- `20260715120000_equipment_first_load_domain`
- `20260715150000_add_mobile_equipment_snapshot_revisions`
- `20260715170000_preserve_session_exercise_membership`
- `20260715193000_preserve_equipment_mirror_and_session_order`
- `20260716123000_add_preferred_gym_equipment`
- `20260718030000_add_system_free_weight_profiles`
- `20260718100000_add_structured_coaching_profile`
- `20260718120000_add_exercise_load_profiles`
- `20260720120000_redact_coach_session_prompts`

Do not rewrite or delete these production migration records by hand.

## Safe migration-reconciliation options

### Recommended approach

Preserve the migration history production actually ran.

1. Restore the missing old/local migration directories from the running production container exactly as they are.
2. Preserve the old accepted-feature migration names that production already knows:
   - `20260711033000_add_intra_set_autoregulation`;
   - `20260711150000_add_gym_profiles`;
   - `20260711210000_add_mcp_access_tokens`.
3. Reconcile the three upstream duplicate migrations so they do not try to create the same database objects a second time. They can be compatibility/no-op migrations in our fork, with an explicit comment explaining that the equivalent change already exists under the older SHAREN migration name.
4. Keep genuinely new upstream migrations, especially progress photos, as real migrations.
5. Restore the production-only schema and application code that corresponds to the later local migrations, or explicitly decide feature-by-feature what is being retired. Do not silently drop it from the application model.
6. Test migration deployment from zero on a brand-new empty PostgreSQL database.
7. Clone/backup the production database and test the same repository against that copy. The copy must keep all current data and apply only the truly new/compatibility migrations.
8. Run integration tests for backup, gyms/MCP, Android/mobile API, and ordinary application behavior.
9. Only then deploy to real production.

This approach avoids renaming migration records in production and avoids rebuilding production data.

### Alternative: new baseline

A new single baseline could describe the entire current schema and old migration history could be retired. This produces a cleaner migration folder but requires carefully changing what production considers already applied. It is much easier to make a mistake and is not recommended while the existing production database is healthy.

### Alternative: new database + data copy

A brand-new database could be built from a clean new migration history and all user data copied into it. This produces the cleanest history but requires a full data migration and cutover. It is unnecessary for the current problem unless a future major rewrite makes it worthwhile.

## Android architecture decision under discussion

The intended source of truth should be the GymCoach server database, not a second independent Android database.

Conceptually:

`Android client -> GymCoach HTTP API -> Prisma -> PostgreSQL`

The web UI uses the same server/database. Therefore a set logged on Android should immediately become the same server-side set the web UI reads, and a gym/equipment change made on the web should be what Android reads next.

A local Android database/cache is optional and should not become a second authoritative database. It can be limited to:

- UI/cache data for speed;
- a small pending-operation queue when the network disappears mid-workout;
- temporary offline state that is submitted to the server when connectivity returns.

If Android is mostly a thin native shell around the existing GymCoach web/backend, keeping `/android` in the main repository is reasonable. If it evolves into a large independent native product with a separate release cadence, Play Store pipeline, large Kotlin domain layer, and its own roadmap, then a neighboring `gymcoach-android` repository becomes more attractive.

Before proposing the Android contribution upstream, prefer asking Julien which ownership model he wants rather than sending a huge Android PR without agreement.

## Web PR candidates after database reconciliation

Do not open these until the reconciled tree is green and production-only work has been accounted for.

Potential focused contributions:

1. live-session exercise navigation and exercise strip;
2. editable live-session sets table and set controls;
3. in-session exercise actions;
4. gym-aware weight picker and in-session gym-weight editing;
5. extended MCP physical-equipment inventory;
6. MCP `create_gym` / clone-gym support;
7. history calendar + timezone-aware CSV behavior;
8. small reliability fixes that are still absent from current upstream.

Training-calculation changes should remain separate from UI/infrastructure PRs because they require the repository's training-science review workflow.

## Current local uncommitted work at this checkpoint

After restoring the pre-sync stash, the working tree includes local work for:

- history calendar and history navigation;
- timezone-aware history CSV;
- MCP `create_gym` and clone support;
- related MCP documentation/tests;
- the progress-photo cross-platform relative-path fix.

There are also pre-existing local operational/untracked files (`RUNBOOK.md`, `.ai-bridge/`, local compose/PowerShell files, backups, tickets). Do not mass-delete them.

## Android sync incident discovered after this checkpoint

A separate production incident was investigated later on 2026-08-22. The `create_gym` production image had been built from an older mobile API snapshot and accidentally removed newer Android sync operations, including `UPDATE_PREFERRED_EQUIPMENT`. Production was rolled back to `gymcoach-app:pre-create-gym-20260822` / image `26de81844ca0`, which contains the newer mobile API. The PostgreSQL container was not restarted and production data was not modified.

There is also a stale Android 0.4.49 queue item from 2026-07-29 that Android classified incorrectly as `UPDATE_APP` + non-retryable after an older server rejected the operation type. Full evidence, operation ID, rollback details, and required recovery behavior are documented in:

`docs/android-sync-incident-2026-08-22.md`

Read that document before another server deploy or Android sync-protocol change.

## Immediate next task

Before any production deployment or upstream PR creation:

1. restore the missing production migration files from the live `gymcoach-app` container;
2. recover the matching production-only schema/code from the appropriate local history/deployed source;
3. reconcile the three accepted-feature duplicate migrations without modifying production `_prisma_migrations` by hand;
4. verify a clean database from zero;
5. verify a copy of production;
6. run integration/full tests;
7. then split the web work into focused PR branches and discuss Android repository/ownership with Julien.
