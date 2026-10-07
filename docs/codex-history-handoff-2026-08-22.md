# GymCoach Codex history handoff — 2026-08-22

This document transfers the important GymCoach work previously done through local Codex threads into the ordinary ChatGPT/Home-PC workflow. Read this together with:

- `RUNBOOK.md`
- `docs/upstream-sync-2026-08-22.md`
- `docs/android-sync-incident-2026-08-22.md`

## Why this exists

A large amount of later GymCoach work was not in the branch that ordinary ChatGPT initially inspected. It lived in a separate Codex-managed clone and in Codex thread history. This caused the false impression that the installed Android `0.4.49 (59)` source commit was lost.

It is not lost.

## Authoritative later Codex line

Codex manual-sequential clone:

`D:\codexpro_workspace\gymcoach-manual-sequential`

Branch:

`manual/sequential-release`

Final release commit:

`6b826b5fef5c1a4962b66f9d379010083b75d3bd`

Tag / Android version:

- `v0.4.49`
- Android `0.4.49`
- versionCode `59`

The release was verified by Codex with Android gates, R8/resource shrinking, Baseline Profile, `aapt`, `apksigner`, `zipalign`, `latest.json`, GitHub download roundtrip, full project unit/integration/build/E2E gates, then published as a normal GitHub Release.

## Imported into the main repository

On 2026-08-22 ordinary ChatGPT fetched the manual-sequential line into the current main working repository without merging or touching the working tree.

Local archival ref now exists:

`archive/codex-manual-sequential-v0.4.49`

The fetch also imported tags:

`v0.4.27`, `v0.4.29`, `v0.4.30`, `v0.4.31`, `v0.4.32`, `v0.4.33`, `v0.4.34`, `v0.4.35`, `v0.4.36`, `v0.4.37`, `v0.4.38`, `v0.4.39`, `v0.4.40`, `v0.4.41`, `v0.4.42`, `v0.4.43`, `v0.4.44`, `v0.4.45`, `v0.4.46`, `v0.4.47`, `v0.4.48`, `v0.4.49`.

This means future ChatGPT work can inspect/cherry-pick/diff the exact Codex release code directly from the normal `D:\codexpro_workspace\gymcoach` repository.

Do not merge the archive branch wholesale into `sync/upstream-20260822`. It contains a different, much larger history and must be reconciled feature-by-feature.

At the transfer checkpoint the histories diverge heavily because both lines independently evolved from old upstream:

- `sync/upstream-20260822`: 72 unique commits relative to the archive line;
- Codex archive line: 235 unique commits relative to the sync line;
- common base: `baf2b4974950b3e1d6fb515db1ce77e1c4d20a68`.

## Important Codex threads

### Manual sequential release line

Thread:

`019fa030-a358-7030-b21d-532ddd7d8974`

Title: `GymCoach manual sequential — 1. Android next-set parity`

This thread ultimately carried the sequential release line through Android `0.4.49`.

### Large combined product integration

Thread:

`019f8172-cd21-7012-a1ce-99683ed13883`

Title: `Integrate and deploy all 10 pending GymCoach product changes`

This integrated the main product baseline that the later Android releases were built on.

The combined integration included, among other things:

- safe native GymCoach CSV import from upstream;
- aerobic decoupling / HR drift from upstream;
- structured coaching profile across web/server/MCP;
- multi-muscle exercise load profiles and more reliable volume accounting;
- default/free-weight equipment profiles and Android management;
- canonical editable Android exercise details;
- canonical editable web exercise detail/draft durability;
- unified web exercise catalog/replacement filters;
- integration/verification guard infrastructure.

The immutable combined-head full gate at that stage passed 1242 unit tests, 301 integration tests, 29 E2E plus production build before later sequential releases continued.

### Useful focused threads

- `019fb525-59ab-7452-9625-9c6af7d0f76b` — restore dumbbell history when preferred equipment is missing.
- `019fa3bd-877e-70c2-bf12-743eb0c935bc` — make concrete exercise equipment clickable/editable on Android.
- `019f9b0c-b45c-7411-8488-fa0e01380d74` — native Android exercise replacement with shared filters.
- `019f8c13-57cf-75a0-b02f-78529718fae5` — Android Settings authority migration and incident diagnostics.
- `019f880f-6a65-75e1-958b-edf9335bf1dd` — prevent Android Settings from forcing password re-entry.
- `019f815a-1d2d-7802-bd50-0ec143015503` — canonical editable exercise detail page on web.
- `019f7eb0-585d-78e1-801a-44d8d1898c50` — multi-muscle load profiles / volume accounting verification.
- `019f8045-60aa-7213-9627-8bd8a4a47b57` — native Android management for default Dumbbells/Barbell profiles.

If a future question needs exact design intent rather than only code, fetch the relevant Codex thread by ID through `@Codex_threads` instead of guessing.

## Release-by-release Android/product line

The imported tags map to these exact commits/features:

- `v0.4.27` — `478f71d` — native management of default equipment profiles.
- `v0.4.29` — `25a7843` — Android batch tool invocation fix.
- `v0.4.30` — `47cbdf0` — integrated Android Settings authentication fix.
- `v0.4.31` — `f886e6b` — shared next-set return-limit parity.
- `v0.4.32` — `0129cc8` — advance correctly past completed supersets.
- `v0.4.33` — `91363f2` — active-exercise workout menu.
- `v0.4.34` — `b40450d` — emphasize active workout thumbnail.
- `v0.4.35` — `2a8e9c9` — preserve strength anchors and redesign exercise actions.
- `v0.4.36` — `1d98b69` — edit completed workout sets on Android.
- `v0.4.37` — `9df21c8` — reduce Home scroll composition cost.
- `v0.4.38` — `d9b1a1c` — persist preferred exercise equipment.
- `v0.4.39` — `1977f24` — unified set-value snap pickers.
- `v0.4.40` — `9104151` — exercise history across equipment.
- `v0.4.41` — `05333f9` — manual workout set count.
- `v0.4.42` — `06b3159` — distinguish recovery breaks from true deload need.
- `v0.4.43` — `84378d3` — isolate incompatible sync operations.
- `v0.4.44` — `9c3e2d9` — replace raw user-facing errors with safe categorized reports.
- `v0.4.45` — `24cee6b` — persist finished workout edits offline.
- `v0.4.46` — `db9ae45` — require explicit extra workout sets.
- `v0.4.47` — `062caf0` — restore equipment weight options.
- `v0.4.48` — `eab9563` — confirm program changes after workouts.
- `v0.4.49` — `6b826b5` — runtime/release-distribution performance work, Baseline Profile and optimized release packaging.

## Important training/product contracts recovered from Codex

### Deload vs recovery break

Codex carried an explicit owner requirement that a detected stall must not automatically create another seven-day deload when training load has already collapsed because the user has effectively rested.

The regression scenario was approximately:

- last meaningful completed training around 13 days ago;
- last 7 days: zero workouts and zero working sets;
- 28-day average frequency around 1.25/week against plan 3;
- readiness 4/5, sleep 4/5, no soreness;
- stalled bench and squat signals.

Expected behavior: do not offer another seven-day deload; say the recovery break already occurred and move to conservative return-to-training/calibration.

Cross-exercise accounting was explicitly separated into:

1. exact exercise + equipment for load/e1RM/records/progression;
2. movement family for movement-specific continuity;
3. muscle/joint/fatigue load only where contribution is explicitly known.

Do not merge weights/e1RM between barbell bench, Smith press, dumbbell press and chest press simply because they are related movements.

This product line culminated in release `v0.4.42`, commit `06b3159`.

### Error UX / diagnostics

The owner explicitly required Android never to show raw API discriminator errors, JSON, internal enum names or stack traces in the main UI.

The implemented line culminated in:

- `v0.4.43` `84378d3` — isolate incompatible sync operations;
- `v0.4.44` `9c3e2d9` — categorized user-facing error system, technical-details separation, safe diagnostic reports and redaction.

The error system covers categories including offline, timeout, server temporary, authentication, client/server incompatibility, validation/legacy operation, conflict, not-found/deleted, local storage, file/permission and unknown.

Technical details and downloadable reports may contain sanitized server/exception information, but the ordinary user-facing message is friendly RU/EN copy.

## Exact source of the current stuck sync bug

The installed `0.4.49` source is now available under the archive ref. The current red-card incident is therefore fully inspectable.

Relevant source file in archive branch:

`android/app/src/main/java/org/sharteman/gymcoach/data/repository/GymCoachRepository.kt`

`retryBlockedChange()` rebuilds the stored blocked error and then contains this behavior:

- special restore paths for exercise replacement/mutation;
- otherwise, if `blockedError.retryable` is false, return immediately;
- only retryable errors are marked for retry and scheduled.

Relevant classification file:

`android/app/src/main/java/org/sharteman/gymcoach/data/errors/AppError.kt`

`CLIENT_SERVER_INCOMPATIBLE` is deliberately NOT part of `isRetryable(...)` and is mapped to recovery action `UPDATE_APP`.

Therefore the 2026-08-22 incident is now proven end-to-end:

1. a temporarily downgraded server rejected `UPDATE_PREFERRED_EQUIPMENT` as an unknown discriminator;
2. Android categorized the stored item as `CLIENT_SERVER_INCOMPATIBLE`;
3. this category permanently has `retryable=false` in `0.4.49`;
4. even after the server was restored and can accept the operation, `retryBlockedChange()` refuses to resend the item.

The permanent fix should preserve the distinction between ordinary transient retries and explicit compatibility re-checks. A compatibility-blocked operation must remain safe by default but gain a user/server-capability-driven re-check path after the server changes. Do not simply mark all schema/validation errors infinitely retryable.

The exact blocked operation from the incident is documented separately in `docs/android-sync-incident-2026-08-22.md`.

## Android performance/release work in 0.4.49

Commit `6b826b5` contains:

- process-wide cache for exercise media catalog;
- background JSON encode/decode work;
- lifecycle-aware state collection/bootstrap seeding;
- localization of bootstrap collection to active navigation destinations;
- isolated high-frequency rest timer section;
- memoized heavy workout/progress/recommendation maps;
- stable Lazy list keys/content types;
- release R8/resource shrinking;
- optimized performance build type;
- Baseline Profile module and generated profile;
- release-only publication flow;
- fail-closed signing configuration;
- R8 mapping retention;
- updated integration evidence around release APK instead of debug APK.

The final Codex evidence for `v0.4.49` reported:

- release commit `6b826b5fef5c1a4962b66f9d379010083b75d3bd`;
- APK version `0.4.49 (59)`;
- APK SHA-256 `f78e7c4926f623cf3d6c5194599338587efd2b7aab876a570a53b4b6d7a889fd`;
- APK size `3,379,459` bytes;
- full project gate: 1299 unit, 338 integration, production build, 30 E2E.

## Deployment/process lessons from Codex

Codex already had a strong deployment rule that the 2026-08-22 accidental mobile API downgrade violated:

- canonical runtime is Home-PC port `3030`, public DuckDNS proxies there;
- identify exact currently serving checkout/image before replacing it;
- inspect concurrent/newer worktrees/branches;
- never deploy a stale checkout by copying whole files over newer work;
- preserve both sides of semantic conflicts;
- keep rollback image/state;
- health-check local and public endpoints;
- do not leave temporary runtimes/listeners.

Future ordinary ChatGPT work must follow the same rule.

## Protected/local operational details

The manual sequential line repeatedly treated local untracked `NUL` as protected. Do not delete or modify it during cleanup.

Codex also used canonical Beads as task/evidence authority. The historical Beads/worktree orchestration itself is not required for ordinary ChatGPT to make normal code changes, but if historical task intent/evidence is needed, consult `@Codex_threads` and the canonical Beads state rather than inferring from commit names alone.

## What ordinary ChatGPT should do from now on

1. Treat `archive/codex-manual-sequential-v0.4.49` as the code recovery source for all post-upstream Codex work.
2. Treat `sync/upstream-20260822` as the current upstream-reconciliation line.
3. Never merge those two whole branches blindly.
4. Port production/Codex features intentionally, feature-by-feature, preserving current upstream additions.
5. For Android bugs affecting the installed 0.4.49 app, inspect the archive source first.
6. For exact historical intent or rejected alternatives, fetch the named Codex thread.
7. Keep all migration reconciliation requirements from `docs/upstream-sync-2026-08-22.md` in force.
8. Do not deploy the current sync branch until the production-only database/schema/API line from the Codex archive has been reconciled.
