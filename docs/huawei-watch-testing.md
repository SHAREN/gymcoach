# Huawei watch companion testing

Status: required verification plan. Previewer and simulation results do not prove real Huawei Watch GT 4 sensor, transport, screen-off, or background behavior.

## Test modes

### Mode 1: real watch

```text
Huawei Watch GT 4
        <->
Huawei Wear Engine
        <->
Android phone application
```

This is the authoritative mode for device classification, Wear Engine compatibility, permissions, sensor availability and callback rate, wrist state, vibration, crown behavior, Bluetooth reconnection, screen-off persistence, background limits, storage limits, signed HAP installation, and power behavior.

The release gate requires a physical GT 4 on the target HarmonyOS firmware. A result must include watch model, firmware, watch app version, phone model, Android version, Huawei Health version, HMS Core version, Wear Engine version, protocol version, timestamp, and redacted logs.

### Mode 2: official Previewer harness

```text
DevEco Studio Lite Wearable Previewer
        |
deterministic in-process workout fixture
```

Huawei documentation provides Previewer-based Lite Wearable UI development, not a full Watch GT 4 hardware emulator. The separate `huawei-watch-app/preview-harness` avoids `@system.file` and `@system.wearengine`, renders deterministic workout state and validates navigation, localization, HML/CSS behavior, set start/completion and rest controls. Protocol and reconnect simulation remain covered by Node and Android simulator tests rather than being presented as Previewer Bluetooth evidence.

Do not mark Bluetooth, Wear Engine, sensors, vibration, crown, screen-off execution, background collection, HAP signing, or installation as passed from Previewer alone.

### Mode 3: fully local simulation

The local test stack contains an Android debug transport that implements the
production `WatchTransport` interface, an Android watch-event simulator, and a
dependency-free JavaScript watch core. The implemented Android simulator can:

- Connect and disconnect.
- Request and receive the active workout snapshot.
- Complete sets.
- Change the active exercise.
- Emit valid and invalid test heart-rate samples.
- Queue events offline and reconnect.
- Redeliver duplicate messages and exchange files.

The JavaScript watch-core tests additionally cover set start, edit and delete,
rest controls, revision gaps, conflicts, ordered replay, message limits and
file limits. These are component and local-integration tests, not one complete
Android-to-watch UI end-to-end scenario.

The simulator must be absent from release variants. A release APK test must assert that simulator activities, services, debug transport classes, and manifest entries are not packaged.

## Test layers

| Layer               | Scope                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract            | JSON Schema validation, golden fixtures in both languages, unknown fields, invalid enums, byte-size fixtures, and protocol compatibility.                    |
| Unit                | Revision rules, deduplication, ACK state machine, timer calculations, heart-rate summaries, invalid sample filtering, batching, and conflict classification. |
| Room integration    | Additive migrations, transaction atomicity, inbox uniqueness, outbox recovery, set upsert/delete mapping, sensor batch checksum, and process restart.        |
| Android integration | Wear Engine adapter contract, debug transport, repository reuse, WorkManager server queue, diagnostics redaction, and lifecycle.                             |
| Watch unit          | Local journal, snapshot persistence, timer recovery, UI state reducers, batching, and storage cleanup.                                                       |
| UI                  | Android watch status and debug screens, watch 466 x 466 flows, Russian and English text, touch targets, and error states.                                    |
| Hardware            | Installation, pairing, real transport, permissions, sensors, screen off, background limits, vibration, crown, reconnect, and power.                          |

All clocks, UUID generators, transport, filesystem, sensor collectors, and connection state are injectable in automated tests. Tests use virtual time and absolute timestamps instead of sleeping.

## Required scenario matrix

|   # | Scenario                                 | Primary modes | Required assertions                                                                                                                                                                               |
| --: | ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Start workout on phone                   | 1, 3          | One existing `LocalSessionEntity` is created, runtime state is initialized, and one start event/snapshot is queued.                                                                               |
|   2 | Watch receives workout                   | 1, 2, 3       | Workout name, exercise, targets, timers, revision, connection, and sync status match the phone snapshot.                                                                                          |
|   3 | Open watch app after workout start       | 1, 2, 3       | Persisted or requested state restores the same session without a duplicate start.                                                                                                                 |
|   4 | Complete a set on watch                  | 1, 2, 3       | Stable set ID, start/end time, weight, reps, RIR, source, summary, event, and rest state are committed atomically.                                                                                |
|   5 | Set appears on phone                     | 1, 3          | The existing `LocalSetEntity` is upserted once and the existing server `UPSERT_SET` operation is queued once.                                                                                     |
|   6 | Change exercise on phone                 | 1, 3          | Watch changes to the same valid exercise and revision without resetting elapsed workout time.                                                                                                     |
|   7 | Change exercise on watch                 | 1, 2, 3       | Phone UI and runtime state update once; an invalid exercise ID is rejected.                                                                                                                       |
|   8 | Record weight, repetitions, and RIR      | 1, 2, 3       | Decimal weight and valid integer ranges round-trip without locale corruption in Russian or English.                                                                                               |
|   9 | Record heart rate during a set           | 1, 3          | Valid timestamped samples are tagged `SET` and linked to session, exercise, and set. Real callback behavior passes only in mode 1.                                                                |
|  10 | Record heart rate during rest            | 1, 3          | Samples are tagged `REST`; start, 30-second, 60-second, minimum, average, and recovery values use valid samples only.                                                                             |
|  11 | Calculate average and maximum heart rate | 1, 3          | Deterministic fixtures verify min, max, average, start, end, sample count, and set duration.                                                                                                      |
|  12 | Discard invalid heart rate               | 1, 3          | Off-wrist, missing, out-of-range, or invalid-quality samples are flagged, excluded from summaries, and never replaced with zero.                                                                  |
|  13 | Rest timer                               | 1, 2, 3       | Skip, add 15, add 30, pause, finish, and start-next-set use `restEndsAt` and produce the required events.                                                                                         |
|  14 | Restore timer after screen sleep         | 1, 2, 3       | Remaining time is recalculated from absolute timestamps. Screen-off reliability is accepted only from mode 1.                                                                                     |
|  15 | Lose Bluetooth connection                | 1, 3          | Connection state changes, local timers and commands continue, events remain durable, and no workout is auto-finished.                                                                             |
|  16 | Continue workout without phone           | 1, 3          | Multiple exercises and sets persist locally, survive navigation, and remain queued until reconnection.                                                                                            |
|  17 | Restore synchronization                  | 1, 3          | Handshake compares revisions, replays gaps in order, transfers pending files, ACKs them, and converges both views.                                                                                |
|  18 | Redeliver the same event                 | 1, 3          | Same ID and hash returns `DUPLICATE`; no second set, timer, sensor batch, or server operation is created.                                                                                         |
|  19 | Conflict changes                         | 1, 3          | Concurrent edit/delete and same-field edits preserve both payloads in the conflict journal and require explicit resolution.                                                                       |
|  20 | Restart Android app                      | 1, 3          | Room restores session, active state, receipts, pending events, timers, and connection recovery without data loss.                                                                                 |
|  21 | Restart watch app                        | 1, 2, 3       | Local snapshot and outbox restore; the app requests reconciliation and does not duplicate already acknowledged events.                                                                            |
|  22 | Finish workout                           | 1, 2, 3       | Both devices show the same finished state, no new set can attach accidentally, pending data syncs, and history uses the existing session.                                                         |
|  23 | Large workout                            | 1, 2, 3       | Many exercises, sets, edits, and sensor samples remain responsive, ordered, bounded in storage, and recoverable.                                                                                  |
|  24 | Wear Engine size limits                  | 1, 3          | The outbound engineering target is 900 bytes, the inbound hard limit is 1,024 bytes, and the file target is 3.5 MiB while remaining strictly below 4 MB; oversized data is split and checksummed. |

## Current Stage 6 evidence

This table records the current local audit on 2026-07-15. Tester: Codex local
source, build and Previewer audit. Environment: the Windows Home PC toolchains
documented in `huawei-development-environment.md`, including DevEco Studio
`6.1.1.280`, watch SDK `5.0.2.306` and Android Wear Engine `5.0.3.304`, but no
signed HAP or physical GT 4 test. The Android database is Room schema version 9.
On this workstation:

- `huawei-watch-app/npm run check`: 80 tests passed, 0 failed; bundle freshness and formatting also passed.
- Production watch HAP: official Hvigor `assembleHap` passed; unsigned output is 766,342 bytes with SHA-256 `280162AF829419C10279690D2BCADC601ADF95ABE82D4029187FBC65ED1D53AC`.
- Preview harness HAP: official Hvigor `assembleHap` passed; unsigned output is 162,636 bytes with SHA-256 `EC60F974D4AE4A357B05A26EF2B960013C27D13EFA44ACC2FF99BAFB7FF0F6BC`. DevEco synchronized the integration worktree project, and owner-provided current-worktree evidence covers the Russian home render, workout/rest navigation, rest controls and locale switching. The frozen rest countdown is accepted for this integration and tracked separately.
- `shared-contracts/test-contracts.mjs`: 15 schemas and 15 examples passed.
- `scripts/verify.sh` and `scripts/verify.sh --full`: 125 web test files and 1058 tests, 41 integration files and 275 tests, and 18 Playwright tests passed, followed by lint, typecheck and production build.
- `android/gradlew.bat testDebugUnitTest`: 49 test suites and 237 tests passed, 0 failed.
- Android `testDebugUnitTest`, `lintDebug`, `assembleDebug` and release Kotlin compilation passed with Wear Engine `5.0.3.304`.
- Published APK `gymcoach-26-407545c58172.apk`: 21,675,068 bytes; SHA-256 `407545c581725b8ab004f239c81a168e09a666dbc763df0b2518496362700d68`. The source APK, hash-qualified published APK and `latest.json` match; no `gymcoach-latest.apk` alias was produced.
- API 34 Room instrumentation: 6 migration tests passed, including migration 8 to 9.

The final local recovery audit passed for idempotent event replay, conflict
deduplication and resolution, large offline workouts, bounded storage,
non-destructive Lite file read/delete failures, SDK timeout normalization,
continued Android command processing after a transport failure, and in-process
Wear Engine reconnect with durable pending replay. Equipment-snapshot
validation and the 900/1,024-byte plus 3.5 MiB transport targets also remain
green. Production Wear Engine transport, Lite file storage, both DevEco builds
and the accepted current-worktree Previewer smoke are verified locally. Huawei
service approval, App ID, `DEVICE_MANAGER`, HAP signing and physical-watch
behavior remain owner-controlled external gates.

`automated-pass` means that the deterministic local assertions listed in the
evidence column passed. It does not promote a simulator result to real-device
evidence. `source-implemented-not-e2e` means the participating components and
tests exist but the entire scenario is not exercised through both production
application entry points. Rows whose final acceptance depends on Huawei
service approval, a signed HAP or a physical watch remain blocked. This snapshot should be updated if
a later integration commit adds a direct scenario test.

|   # | Scenario                                 | Status                       | Evidence and remaining limitation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --: | ---------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | Start workout on phone                   | `source-implemented-not-e2e` | The existing repository creates one session/runtime and publishes ordered watch commands in [`GymCoachRepositorySyncTest.kt:68`](../android/app/src/test/java/org/sharteman/gymcoach/data/repository/GymCoachRepositorySyncTest.kt#L68) and [`GymCoachRepositorySyncTest.kt:110`](../android/app/src/test/java/org/sharteman/gymcoach/data/repository/GymCoachRepositorySyncTest.kt#L110). Durable-before-dispatch behavior is covered by [`WatchIntegrationRuntimeTest.kt:24`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchIntegrationRuntimeTest.kt#L24), but no single test follows the start through the watch UI.   |
|   2 | Watch receives workout                   | `source-implemented-not-e2e` | Snapshot rendering passes in [`workout.test.mjs:102`](../huawei-watch-app/test/workout.test.mjs#L102). The Android debug transport exchanges events, ACKs and files, and the production Huawei adapter now compiles and has transport-level unit tests. A signed two-device delivery is still unverified.                                                                                                                                                                                                                                                                                                                                        |
|   3 | Open watch app after workout start       | `source-implemented-not-e2e` | Snapshot/open and retained-backend behavior are tested in [`workout.test.mjs:102`](../huawei-watch-app/test/workout.test.mjs#L102) and [`workout.test.mjs:213`](../huawei-watch-app/test/workout.test.mjs#L213). Production now injects Lite file-backed storage and Wear Engine, but real process restart recovery remains a signed-watch scenario.                                                                                                                                                                                                                                                                                             |
|   4 | Complete a set on watch                  | `source-implemented-not-e2e` | Stable IDs and exact set values pass in [`workout.test.mjs:157`](../huawei-watch-app/test/workout.test.mjs#L157); sensor flush and rest start pass in [`stage4.test.mjs:382`](../huawei-watch-app/test/stage4.test.mjs#L382). Atomic official watch storage and phone delivery are not verified.                                                                                                                                                                                                                                                                                                                                                 |
|   5 | Set appears on phone                     | `source-implemented-not-e2e` | Existing `LocalSetEntity` upsert and single server outbox operation are covered at the coordinator boundary by [`WatchWorkoutCoordinatorTest.kt:104`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchWorkoutCoordinatorTest.kt#L104). There is no complete debug-transport-to-Room UI test.                                                                                                                                                                                                                                                                                                                                 |
|   6 | Change exercise on phone                 | `source-implemented-not-e2e` | The repository publishes the command in [`GymCoachRepositorySyncTest.kt:68`](../android/app/src/test/java/org/sharteman/gymcoach/data/repository/GymCoachRepositorySyncTest.kt#L68), and watch state application passes in [`workout.test.mjs:117`](../huawei-watch-app/test/workout.test.mjs#L117). No test drives the phone UI and watch UI together.                                                                                                                                                                                                                                                                                          |
|   7 | Change exercise on watch                 | `source-implemented-not-e2e` | Durable watch event generation passes in [`workout.test.mjs:138`](../huawei-watch-app/test/workout.test.mjs#L138), and phone runtime application passes in [`WatchWorkoutCoordinatorTest.kt:71`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchWorkoutCoordinatorTest.kt#L71). Full UI propagation is not exercised.                                                                                                                                                                                                                                                                                                       |
|   8 | Record weight, repetitions and RIR       | `source-implemented-not-e2e` | Decimal weight and integer values are preserved in [`workout.test.mjs:157`](../huawei-watch-app/test/workout.test.mjs#L157) and contract ranges in [`contracts.test.mjs:120`](../huawei-watch-app/test/contracts.test.mjs#L120). There is no explicit Russian-versus-English numeric-entry round-trip test.                                                                                                                                                                                                                                                                                                                                      |
|   9 | Record heart rate during a set           | `blocked-hardware`           | Debug collection, phase linkage and set flushing pass in [`stage4.test.mjs:382`](../huawei-watch-app/test/stage4.test.mjs#L382). Real callbacks, health permission and sampling cadence require a signed Watch GT 4 run.                                                                                                                                                                                                                                                                                                                                                                                                                         |
|  10 | Record heart rate during rest            | `blocked-hardware`           | REST calculations pass in [`stage4.test.mjs:286`](../huawei-watch-app/test/stage4.test.mjs#L286), [`stage4.test.mjs:577`](../huawei-watch-app/test/stage4.test.mjs#L577) and [`WatchWorkoutCoordinatorTest.kt:459`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchWorkoutCoordinatorTest.kt#L459). Calculations pass locally; real rest-phase heart-rate collection remains unverified on signed hardware.                                                                                                                                                                                                                 |
|  11 | Calculate average and maximum heart rate | `automated-pass`             | Deterministic min/max/average/start/end/count assertions pass in [`stage4.test.mjs:286`](../huawei-watch-app/test/stage4.test.mjs#L286) and [`HeartRateSummaryCalculatorTest.kt:9`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sensors/HeartRateSummaryCalculatorTest.kt#L9).                                                                                                                                                                                                                                                                                                                                                     |
|  12 | Discard invalid heart rate               | `automated-pass`             | Off-wrist and invalid samples remain null and are excluded by [`stage4.test.mjs:176`](../huawei-watch-app/test/stage4.test.mjs#L176) and [`HeartRateSummaryCalculatorTest.kt:36`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sensors/HeartRateSummaryCalculatorTest.kt#L36).                                                                                                                                                                                                                                                                                                                                                      |
|  13 | Rest timer                               | `automated-pass`             | Pause, resume, skip, start-next-set, absolute time and vibration cues pass in [`stage4.test.mjs:445`](../huawei-watch-app/test/stage4.test.mjs#L445), [`stage4.test.mjs:521`](../huawei-watch-app/test/stage4.test.mjs#L521) and [`stage4.test.mjs:550`](../huawei-watch-app/test/stage4.test.mjs#L550).                                                                                                                                                                                                                                                                                                                                         |
|  14 | Restore timer after screen sleep         | `blocked-hardware`           | Absolute-time restoration passes against the storage abstraction in [`stage4.test.mjs:521`](../huawei-watch-app/test/stage4.test.mjs#L521), and production uses Lite file storage. Real screen-off execution still requires a signed GT 4 test.                                                                                                                                                                                                                                                                                                                                                                                                  |
|  15 | Lose Bluetooth connection                | `blocked-hardware`           | Local disconnect/replay passes in [`stage5.test.mjs:220`](../huawei-watch-app/test/stage5.test.mjs#L220), and debug transport connection behavior is exercised by [`DebugWatchTransportEndToEndTest.kt:27`](../android/app/src/test/java/org/sharteman/gymcoach/watch/simulator/DebugWatchTransportEndToEndTest.kt#L27). Official adapters compile and local disconnect/replay passes; real Bluetooth/Wear Engine reconnect remains unverified on signed hardware.                                                                                                                                                                               |
|  16 | Continue workout without phone           | `source-implemented-not-e2e` | Offline events, files and raw sensor retention pass in [`stage5.test.mjs:220`](../huawei-watch-app/test/stage5.test.mjs#L220) and [`stage5.test.mjs:241`](../huawei-watch-app/test/stage5.test.mjs#L241). A multi-exercise offline UI run with production persistence is absent.                                                                                                                                                                                                                                                                                                                                                                 |
|  17 | Restore synchronization                  | `source-implemented-not-e2e` | Snapshot reconciliation and gap replay pass in [`stage5.test.mjs:382`](../huawei-watch-app/test/stage5.test.mjs#L382), [`stage5.test.mjs:447`](../huawei-watch-app/test/stage5.test.mjs#L447), [`WatchSyncPersistenceTest.kt:31`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchSyncPersistenceTest.kt#L31) and [`WatchInboundEventRouterTest.kt:35`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchInboundEventRouterTest.kt#L35). No complete two-application convergence test exists.                                                                                                             |
|  18 | Redeliver the same event                 | `automated-pass`             | Watch receipt deduplication passes in [`workout.test.mjs:190`](../huawei-watch-app/test/workout.test.mjs#L190); phone set/server-outbox deduplication passes in [`WatchWorkoutCoordinatorTest.kt:104`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchWorkoutCoordinatorTest.kt#L104) and ACK deduplication in [`WatchSyncPersistenceTest.kt:51`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchSyncPersistenceTest.kt#L51).                                                                                                                                                                          |
|  19 | Conflict changes                         | `automated-pass`             | Replayed rejection ACKs deduplicate and a later success resolves the watch conflict in [`stage5.test.mjs:190`](../huawei-watch-app/test/stage5.test.mjs#L190). Concurrent edit/delete retains both hashes and reconciles to the confirmed snapshot in [`stage6-stress.test.mjs:376`](../huawei-watch-app/test/stage6-stress.test.mjs#L376). Phone-side ambiguous-equipment conflict replay and resolution are covered in [`GymCoachRepositorySyncTest.kt:1155`](../android/app/src/test/java/org/sharteman/gymcoach/data/repository/GymCoachRepositorySyncTest.kt#L1155). This is automated local evidence, not production Wear Engine evidence. |
|  20 | Restart Android app                      | `source-implemented-not-e2e` | Inbox/outbox recovery logic passes in [`WatchSyncPersistenceTest.kt:20`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchSyncPersistenceTest.kt#L20) and [`WatchSyncPersistenceTest.kt:31`](../android/app/src/test/java/org/sharteman/gymcoach/watch/sync/WatchSyncPersistenceTest.kt#L31); Room migrations through 8-to-9 pass in [`GymCoachDatabaseMigrationTest.kt:281`](../android/app/src/androidTest/java/org/sharteman/gymcoach/data/local/GymCoachDatabaseMigrationTest.kt#L281). A production process-death runtime test is absent.                                                                                |
|  21 | Restart watch app                        | `source-implemented-not-e2e` | Retained-backend restart behavior passes in [`workout.test.mjs:213`](../huawei-watch-app/test/workout.test.mjs#L213), and production uses Lite file-backed storage. Real process restart persistence remains unverified on signed hardware.                                                                                                                                                                                                                                                                                                                                                                                                      |
|  22 | Finish workout                           | `source-implemented-not-e2e` | Finished-state reducers pass in [`workout.test.mjs:227`](../huawei-watch-app/test/workout.test.mjs#L227), and finished summary persistence in [`stage6-ui.test.mjs:98`](../huawei-watch-app/test/stage6-ui.test.mjs#L98). Same-state convergence, rejection of later sets and server-history reuse are not tested as one scenario.                                                                                                                                                                                                                                                                                                               |
|  23 | Large workout                            | `automated-pass`             | A large offline workout survives restart and reconnect without loss in [`stage6-stress.test.mjs:164`](../huawei-watch-app/test/stage6-stress.test.mjs#L164). Bounded receipt retention, sensor batching and concurrent edits are also exercised by the Stage 6 stress suite. This does not prove responsiveness or storage behavior on real GT 4 hardware.                                                                                                                                                                                                                                                                                       |
|  24 | Wear Engine size limits                  | `automated-pass`             | The 900-byte outbound target and 1,024-byte inbound hard limit pass in [`messages.test.mjs:45`](../huawei-watch-app/test/messages.test.mjs#L45), [`messages.test.mjs:51`](../huawei-watch-app/test/messages.test.mjs#L51), [`messages.test.mjs:62`](../huawei-watch-app/test/messages.test.mjs#L62) and [`contracts.test.mjs:167`](../huawei-watch-app/test/contracts.test.mjs#L167). The 3.5 MiB file target below the 4 MB boundary, checksum and envelope reservation pass in [`stage6-stress.test.mjs:328`](../huawei-watch-app/test/stage6-stress.test.mjs#L328).                                                                           |

## Additional negative and security tests

- Reject a watch event for another authenticated phone user or unknown session.
- Reject reused event IDs with a different payload hash.
- Reject malformed JSON, unknown required enum values, nonfinite numbers, negative timestamps, and invalid set ranges.
- Reject a file with mismatched length, checksum, schema, session, or batch ID.
- Verify logs and exported diagnostics contain no bearer token, cookie, email, display name, exercise notes, raw free text, full device ID, or raw sensor stream.
- Verify signing material and Huawei account files are ignored by Git.
- Verify production refuses the debug transport and `SIMULATOR` source.
- Verify a snapshot cannot erase a local unacknowledged set or tombstone.

## UI verification

Test the watch screens at 466 x 466 in Russian and English:

- Home and connection state.
- Active exercise, set number, weight, repetitions, RIR, heart rate, elapsed time, connection, and sync status.
- Touch-first set editing and, only if runtime-supported, crown editing.
- Rest countdown, recovery values, next target, skip, add time, pause, and start set.
- Exercise and workout summaries.
- Pending events and sanitized last error.

Capture Previewer screenshots for layout regression. Capture real-watch photos or screen recordings separately for hardware evidence. Previewer screenshots must not be labeled as real-device proof.

## Stage gates

The official toolchain and Previewer gates are now available locally. HAP signing, Huawei service approval and physical installation still require the owner's HUAWEI ID, certificates, phone and watch. A Previewer or simulator pass must not be substituted for that hardware gate.

After every implementation stage:

1. Build and test the existing Android application.
2. Build and test the watch project with the installed official toolchain.
3. Validate all shared schemas and cross-language fixtures.
4. Run the relevant scenario subset in mode 3.
5. Run relevant UI paths in Previewer.
6. Run hardware-dependent scenarios in mode 1 when a registered GT 4 is available.
7. Record exact versions and evidence.
8. Commit the stage separately with a focused Conventional Commit message.

Android changes must also pass the repository Android publishing gate:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Instrumentation tests are run on the configured Android emulator or phone. Pure watch work does not permit publishing a stale Android APK after Android integration code changes.

## Release evidence checklist

- Android unit, lint, assembly, and affected instrumentation tests are green.
- Watch build and available unit/UI tests are green.
- Shared contract fixtures pass in Android and JavaScript.
- No debug simulator code is present in production packages.
- All 24 scenarios have a status, evidence link, tester, date, and environment.
- Hardware-only rows are not marked passed without a registered physical GT 4.
- APK metadata and hash match the newly assembled Android artifact after Android code changes.
- Signed HAP package name, certificate, profile, and hash are recorded without storing secrets.
- Diagnostics export is manually inspected for privacy.

## Official references

- [Lite Wearable experience and Previewer](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V3/lite-wearable-experience-0000000000622606-V3)
- [Running a fitness watch application](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V2/run_fitnesswatch-0000001054134240-V2)
- [Sending a Wear Engine message](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/send-message-0000001052460491)
