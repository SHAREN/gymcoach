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

### Mode 2: official Previewer plus debug transport

```text
DevEco Studio Lite Wearable Previewer
        <->
debug transport fixture
        <->
Android application or local test process
```

Huawei documentation provides Previewer-based Lite Wearable UI development, not a full Watch GT 4 hardware emulator. Previewer validates 466 x 466 layout, navigation, localization, HML/CSS behavior, compact state rendering, and deterministic UI timers. A debug transport adapter feeds the same schemas as Wear Engine.

Do not mark Bluetooth, Wear Engine, sensors, vibration, crown, screen-off execution, background collection, HAP signing, or installation as passed from Previewer alone.

### Mode 3: fully local simulation

The Android debug source set contains a watch simulator that uses the production `WatchTransport` interface and protocol schemas. It can:

- Connect and disconnect.
- Request and receive the active workout snapshot.
- Start, edit, complete, and delete sets.
- Change the active exercise.
- Start, adjust, finish, and skip rest.
- Emit valid and invalid test heart-rate samples.
- Queue events offline and reconnect.
- Redeliver duplicates and reorder selected deliveries.
- Create controlled revision conflicts.
- Exercise the 1 KB message and 4 MB file boundaries.

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

|   # | Scenario                                 | Primary modes | Required assertions                                                                                                                                              |
| --: | ---------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Start workout on phone                   | 1, 3          | One existing `LocalSessionEntity` is created, runtime state is initialized, and one start event/snapshot is queued.                                              |
|   2 | Watch receives workout                   | 1, 2, 3       | Workout name, exercise, targets, timers, revision, connection, and sync status match the phone snapshot.                                                         |
|   3 | Open watch app after workout start       | 1, 2, 3       | Persisted or requested state restores the same session without a duplicate start.                                                                                |
|   4 | Complete a set on watch                  | 1, 2, 3       | Stable set ID, start/end time, weight, reps, RIR, source, summary, event, and rest state are committed atomically.                                               |
|   5 | Set appears on phone                     | 1, 3          | The existing `LocalSetEntity` is upserted once and the existing server `UPSERT_SET` operation is queued once.                                                    |
|   6 | Change exercise on phone                 | 1, 3          | Watch changes to the same valid exercise and revision without resetting elapsed workout time.                                                                    |
|   7 | Change exercise on watch                 | 1, 2, 3       | Phone UI and runtime state update once; an invalid exercise ID is rejected.                                                                                      |
|   8 | Record weight, repetitions, and RIR      | 1, 2, 3       | Decimal weight and valid integer ranges round-trip without locale corruption in Russian or English.                                                              |
|   9 | Record heart rate during a set           | 1, 3          | Valid timestamped samples are tagged `SET` and linked to session, exercise, and set. Real callback behavior passes only in mode 1.                               |
|  10 | Record heart rate during rest            | 1, 3          | Samples are tagged `REST`; start, 30-second, 60-second, minimum, average, and recovery values use valid samples only.                                            |
|  11 | Calculate average and maximum heart rate | 1, 3          | Deterministic fixtures verify min, max, average, start, end, sample count, and set duration.                                                                     |
|  12 | Discard invalid heart rate               | 1, 3          | Off-wrist, missing, out-of-range, or invalid-quality samples are flagged, excluded from summaries, and never replaced with zero.                                 |
|  13 | Rest timer                               | 1, 2, 3       | Skip, add 15, add 30, pause, finish, and start-next-set use `restEndsAt` and produce the required events.                                                        |
|  14 | Restore timer after screen sleep         | 1, 2, 3       | Remaining time is recalculated from absolute timestamps. Screen-off reliability is accepted only from mode 1.                                                    |
|  15 | Lose Bluetooth connection                | 1, 3          | Connection state changes, local timers and commands continue, events remain durable, and no workout is auto-finished.                                            |
|  16 | Continue workout without phone           | 1, 3          | Multiple exercises and sets persist locally, survive navigation, and remain queued until reconnection.                                                           |
|  17 | Restore synchronization                  | 1, 3          | Handshake compares revisions, replays gaps in order, transfers pending files, ACKs them, and converges both views.                                               |
|  18 | Redeliver the same event                 | 1, 3          | Same ID and hash returns `DUPLICATE`; no second set, timer, sensor batch, or server operation is created.                                                        |
|  19 | Conflict changes                         | 1, 3          | Concurrent edit/delete and same-field edits preserve both payloads in the conflict journal and require explicit resolution.                                      |
|  20 | Restart Android app                      | 1, 3          | Room restores session, active state, receipts, pending events, timers, and connection recovery without data loss.                                                |
|  21 | Restart watch app                        | 1, 2, 3       | Local snapshot and outbox restore; the app requests reconciliation and does not duplicate already acknowledged events.                                           |
|  22 | Finish workout                           | 1, 2, 3       | Both devices show the same finished state, no new set can attach accidentally, pending data syncs, and history uses the existing session.                        |
|  23 | Large workout                            | 1, 2, 3       | Many exercises, sets, edits, and sensor samples remain responsive, ordered, bounded in storage, and recoverable.                                                 |
|  24 | Wear Engine size limits                  | 1, 3          | Serialized messages stay at most 900 bytes and strictly under 1 KB; files stay at most 3.5 MiB and strictly under 4 MB; oversized data is split and checksummed. |

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

If the official DevEco download or SDK manager is blocked by HUAWEI ID sign-in, stage 2 may continue with shared-contract tests, the debug transport, Android simulator, and source-level watch project validation. The watch build and HAP installation gate remains explicitly blocked until the owner signs in and installs the official toolchain. A simulator pass must not be substituted for that gate.

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
