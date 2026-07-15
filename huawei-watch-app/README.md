# GymCoach Huawei Watch companion

This directory contains the Stage 3 source project for the Huawei Watch GT 4 companion. It is intentionally separate from the existing Android project.

## Verified target

- Device family: Huawei WATCH GT series supported by Wear Engine from WATCH GT 3 onward.
- Watch GT 4 Lite Wearable classification: runtime verification required on the real device.
- Application stack: JavaScript, HML, and CSS.
- Target compile SDK: Lite Wearable compile SDK 10.
- Reviewed Lite Wearable SDK release: `5.0.2.306`.
- UI target: round 466 x 466 display.
- Transport limits: at most 1,024 UTF-8 bytes per direct message and less than 4,000,000 bytes per file.

The normative Stage 2 control-plane envelope is `../shared-contracts/schemas/v1/control-message.schema.json`. It is separate from workout events and uses only `PING`, `PONG`, `SYNC_REQUESTED`, and `SYNC_SNAPSHOT`.

## Current Stage 3 scope

Implemented now:

- A home and connection-check page in HML, CSS, and JavaScript.
- Dependency-free ping, pong, connection, reconnect, and state-request domain logic.
- A transport interface with an explicit unavailable production fallback.
- A debug-only in-process transport under `src/debug`.
- A storage abstraction that can be backed by the official Lite Wearable storage API later.
- Durable outbox and inbound-message receipt behavior at the abstraction boundary.
- Strict dependency-free validation and serialization for `WatchEvent`, `SyncSnapshot`, `WorkoutSession`, `ExerciseSession`, and `SetRecord`.
- A persisted active workout projection with exercises, active exercise and set, revision, absolute `startedAt`, and completed sets.
- Standalone snapshot application and Stage 3 workout-event reducers.
- Durable watch-originated exercise and set events that replay after reconnect.
- A round-screen home card, active-workout screen, touch-first set entry, and Russian or English labels.
- Correction and deletion of the last completed set for the active exercise.
- Direct-message delivery through 1,024 bytes with file fallback below 4,000,000 bytes.
- Node tests for connection, snapshots, exercise changes, sets, restart recovery, deduplication, strict DTOs, and transport limits.

Not implemented in Stage 2:

- Rest timer and rest screens.
- Sensor APIs or health permissions.
- Production Wear Engine calls.
- HAP signing or installation.
- Production simulation or fake sensor values.

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
    contracts.js
    i18n.js
    messages.js
    storage.js
    transport.js
    workout-state.js
  src/debug/
    debug-transport.js
  test/
    companion.test.mjs
    contracts.test.mjs
    messages.test.mjs
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

## Implemented Stage 3 flow

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
10. Keep raw sensor and rest behavior out of Stage 3.

See `../docs/huawei-watch-gt4-capabilities.md` and `../docs/huawei-development-environment.md` for official capability and environment evidence.
