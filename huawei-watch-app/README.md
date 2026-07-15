# GymCoach Huawei Watch companion

This directory contains the Stage 6 source project for the Huawei Watch GT 4 companion. It is intentionally separate from the existing Android project.

## Verified target

- Device family: Huawei WATCH GT series supported by Wear Engine from WATCH GT 3 onward.
- Watch GT 4 Lite Wearable classification: runtime verification required on the real device.
- Application stack: JavaScript, HML, and CSS.
- Target compile SDK: Lite Wearable compile SDK 10.
- Reviewed Lite Wearable SDK release: `5.0.2.306`.
- UI target: round 466 x 466 display.
- Transport limits: a 900-byte outbound engineering target, a 1,024-byte inbound hard limit, and less than 4,000,000 bytes per file.

The normative Stage 2 control-plane envelope is `../shared-contracts/schemas/v1/control-message.schema.json`. It is separate from workout events and uses only `PING`, `PONG`, `SYNC_REQUESTED`, and `SYNC_SNAPSHOT`.

## Current Stage 6 scope

Implemented now:

- A home and connection-check page in HML, CSS, and JavaScript.
- Dependency-free ping, pong, connection, reconnect, and state-request domain logic.
- A transport interface with an explicit unavailable production fallback.
- A debug-only in-process transport under `src/debug`.
- A storage abstraction that can be backed by the official Lite Wearable storage API later.
- Durable outbox and inbound-message receipt behavior at the abstraction boundary.
- Canonical full-event SHA-256 receipt records that detect changed content under a reused `eventId`.
- Strict `SyncAck` handling. Only `APPLIED` and `DUPLICATE` remove acknowledged events, paired files, and raw sensor samples.
- Sanitized conflict records, peer and snapshot watermarks, last-sync state, and restart-safe pending file transfers.
- Strict dependency-free validation and serialization for `WatchEvent`, `SyncSnapshot`, `WorkoutSession`, `ExerciseSession`, and `SetRecord`.
- A persisted active workout projection with exercises, active exercise and set, revision, absolute `startedAt`, and completed sets.
- Standalone snapshot application and Stage 3 workout-event reducers.
- A compact home screen with active and last-workout state.
- Exercise and workout summaries with volume, RIR, set/rest heart rate, recovery, duration, and synchronization status.
- Compact Russian and English diagnostics with pending-event and sanitized error state.
- Durable watch-originated exercise and set events that replay after reconnect.
- A round-screen home card, active-workout screen, touch-first set entry, and Russian or English labels.
- Correction and deletion of the last completed set for the active exercise.
- Direct-message delivery through the 900-byte outbound target, a 1,024-byte inbound validator, and file fallback below 4,000,000 bytes.
- A strict `SensorCollector` abstraction and explicit unavailable production collectors for every documented candidate sensor.
- Debug-only sensor and vibration adapters that never enter the production page entry.
- Valid and invalid sensor sample normalization. Off-wrist and invalid heart rate is stored as `null`, never as a real zero pulse.
- Bounded persistent sensor storage, strict `SensorBatch` validation, batch splitting, and file-only transfer below 4,000,000 bytes.
- Strict `FileTransferEnvelope` validation with canonical payload length and SHA-256, a 3,500,000-byte target, and the hard Huawei limit.
- Automatic offline-safe sensor batching on reconnect, lifecycle checkpoints, set/rest completion, rest skip, workout finish, and before buffer overflow.
- Deterministic set and rest heart-rate summaries that exclude invalid samples and use the earlier sample for equal-distance 30-second or 60-second ties.
- Absolute workout, set, pause, and rest timing that survives page sleep and transport loss, and survives application restart when backed by a persistent storage adapter.
- Automatic rest start after set completion, plus skip, add 15 seconds, add 30 seconds, pause, resume, and start-next-set controls.
- Persisted one-shot warning and completion vibration cues through an adapter boundary.
- A round-screen rest view with Russian and English labels, current pulse, countdown, summary values, and touch controls.
- Snapshot reconciliation with optional absolute runtime state, deterministic local replay, and a new snapshot request on revision gaps.
- Node tests for ACK outcomes, event-ID reuse, offline revisions, reconnect replay, restart recovery, sensor ownership, corrupt files, snapshots, timers, strict DTOs, and transport limits.

Not implemented or not claimed in Stage 6:

- Official production sensor APIs or health permission calls, because the installed SDK is unavailable.
- Production Wear Engine calls or a verified physical-device transport.
- Rotating crown input. No crown UI or API is present until official support is verified.
- Guaranteed continuous heart-rate collection while the screen is asleep or the application is in deep background.
- HAP signing or installation.
- Production simulation or fake sensor values. Test readings remain under `src/debug`.

## Source layout

```text
huawei-watch-app/
  entry/src/main/js/default/
    app.js
    pages/index/
      index.js
      index.hml
      index.css
  src/core/
    companion.js
    canonical-json.js
    contracts.js
    i18n.js
    messages.js
    sensors.js
    storage.js
    summary-navigation.js
    timers.js
    transport.js
    vibration.js
    workout-summary.js
    workout-state.js
  src/debug/
    debug-sensor-collector.js
    debug-transport.js
    debug-vibration.js
  test/
    companion.test.mjs
    contracts.test.mjs
    entry.test.mjs
    messages.test.mjs
    stage4.test.mjs
    stage5.test.mjs
    stage6-ui.test.mjs
    workout.test.mjs
  scripts/
    check-format.mjs
```

The `entry/src/main/js/default` tree follows Huawei's documented Lite Wearable JavaScript, HML, and CSS application model. The dependency-free core stays outside platform code so it can be verified with Node before DevEco Studio is available.

## DevEco project metadata blocker

DevEco Studio, the Lite Wearable SDK, Previewer, and DevEco Assistant are not installed on this workstation. Huawei's official download route currently redirects to interactive HUAWEI ID sign-in. The owner must complete that sign-in and install the official tools. No third-party SDK or template is an acceptable substitute.

This repository therefore does not invent or hand-author DevEco-version-specific build metadata, generated module files, signing configuration, or Wear Engine imports. After the official SDK is installed:

1. Use the official DevEco Studio wizard to create a Lite Wearable JavaScript project with compile SDK 10.
2. Compare its generated project and module metadata with this directory.
3. Keep the source files in `entry/src/main/js/default` and `src/core`.
4. Add the official generated page route and module metadata without guessing field names.
5. Add the official Lite storage adapter and Wear Engine adapter using the exact installed SDK APIs.
6. Put `src/debug` only in a debug or Previewer-specific product. Do not package it in a production HAP.
7. Build, sign, and run the HAP through the official owner-controlled workflow.

Until those steps are complete, this directory is a real source project with executable core tests, but it is not claimed to be a buildable or signed HAP.

## Runtime boundaries

The page entry imports only `src/core`. It uses `createUnavailableTransport()` and a volatile storage backend until official platform adapters are supplied. This fallback reports that transport is unavailable. It does not simulate a phone, generate pong messages, or claim device persistence. Persistence behavior is verified against the same repository abstraction with a retained backend in Node tests.

The debug transport is isolated under `src/debug` and is imported only by Node tests. A future DevEco debug product may inject it for Previewer work. Production code must use an official Wear Engine adapter and official Lite storage implementation.

## Commands available now

Run from `huawei-watch-app`:

```powershell
npm test
npm run format:check
npm run check
```

No npm dependencies are installed or downloaded. Tests use the Node built-in test runner.

## Implemented Stage 6 flow

With a future official transport adapter, the page flow is:

1. Start disconnected and restore persisted control and active-workout state.
2. Connect through the transport adapter and send or replay `SYNC_REQUESTED`.
3. Accept a strict standalone `SyncSnapshot` through message or file delivery.
4. Render the active workout and current exercise on the 466 x 466 page.
5. Apply phone exercise and set events idempotently by UUID `eventId`.
6. Emit watch exercise changes and set events with opaque domain IDs and durable outbox storage.
7. Reuse a stable `setId` from `SET_STARTED` through `SET_COMPLETED`.
8. Preserve explicit weight, repetitions, and RIR after strict range validation.
9. Replay unacknowledged watch events after reconnect or application restart.
10. Start a rest interval automatically after a completed set and preserve it with absolute timestamps.
11. Collect supported adapter samples in bounded buffers and persist them before summaries or lifecycle transitions.
12. Exclude invalid and off-wrist heart-rate readings from current pulse and aggregate calculations.
13. Atomically queue strict sensor file envelopes and paired durable `SENSOR_BATCH_RECORDED` events before sending.
14. Retain assigned raw samples until an `APPLIED` or `DUPLICATE` ACK survives durable processing.
15. Replay pending files and events in deterministic revision, timestamp, and event-ID order after reconnect.
16. Reconcile snapshots without deleting unresolved local set or delete events and restore absolute runtime timers.
17. Restore timers and one-shot vibration state after sleep, restart, or connection loss.
18. Persist the latest finished workout independently of a newly started session.
19. Preserve exercise-summary selection while navigating between result screens.
20. Include completed and early-ended rest intervals in available recovery summaries without inventing 30- or 60-second values.

The production sensor and vibration adapters intentionally report unavailable until the official DevEco and Lite Wearable SDK APIs can be compiled and verified. This is a safety boundary, not a claim that Watch GT 4 exposes every candidate sensor to third-party Lite Wearable applications.

See `../docs/huawei-watch-gt4-capabilities.md` and `../docs/huawei-development-environment.md` for official capability and environment evidence.
