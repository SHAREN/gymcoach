# GymCoach Huawei Watch companion

This directory contains the Stage 2 source project for the Huawei Watch GT 4 companion. It is intentionally separate from the existing Android project.

## Verified target

- Device family: Huawei WATCH GT series supported by Wear Engine from WATCH GT 3 onward.
- Watch GT 4 Lite Wearable classification: runtime verification required on the real device.
- Application stack: JavaScript, HML, and CSS.
- Target compile SDK: Lite Wearable compile SDK 10.
- Reviewed Lite Wearable SDK release: `5.0.2.306`.
- UI target: round 466 x 466 display.
- Transport limits: at most 1,024 UTF-8 bytes per direct message and less than 4,000,000 bytes per file.

## Current Stage 2 scope

Implemented now:

- A home and connection-check page in HML, CSS, and JavaScript.
- Dependency-free ping, pong, connection, reconnect, and state-request domain logic.
- A transport interface with an explicit unavailable production fallback.
- A debug-only in-process transport under `src/debug`.
- A storage abstraction that can be backed by the official Lite Wearable storage API later.
- Durable outbox and inbound-message receipt behavior at the abstraction boundary.
- Node tests for ping/pong, reconnect and state request, message-size limits, persistence, and duplicate-message idempotency.

Not implemented in Stage 2:

- Workout, set, rest, or sensor screens.
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
    messages.js
    storage.js
    transport.js
  src/debug/
    debug-transport.js
  test/
    companion.test.mjs
    messages.test.mjs
  scripts/
    check-format.mjs
```

The `entry/src/main/js/default` tree follows Huawei's documented Lite Wearable JavaScript, HML, and CSS application model. The dependency-free core stays outside platform code so it can be verified with Node before DevEco Studio is available.

## DevEco project metadata blocker

DevEco Studio, the Lite Wearable SDK, Previewer, and DevEco Assistant are not installed on this workstation. Huawei's official download route currently redirects to interactive HUAWEI ID sign-in. The owner must complete that sign-in and install the official tools. No third-party SDK or template is an acceptable substitute.

This repository therefore does not invent or hand-author DevEco-version-specific build metadata, generated module files, signing configuration, or Wear Engine imports. After the official SDK is installed:

1. Create an official Lite Wearable JavaScript project with compile SDK 10 in DevEco Studio.
2. Compare its generated project and module metadata with this directory.
3. Keep the source files in `entry/src/main/js/default` and `src/core`.
4. Add the official generated page route and module metadata without guessing field names.
5. Add the official Lite storage adapter and Wear Engine adapter using the exact installed SDK APIs.
6. Put `src/debug` only in a debug or Previewer-specific product. Do not package it in a production HAP.
7. Build, sign, and run the HAP through the official owner-controlled workflow.

Until those steps are complete, this directory is a real source project with executable core tests, but it is not claimed to be a buildable or signed HAP.

## Runtime boundaries

The page entry imports only `src/core`. It uses `createUnavailableTransport()` and a volatile storage backend until official platform adapters are supplied. This fallback reports that transport is unavailable. It does not simulate a phone, generate pong messages, or claim persistence.

The debug transport is isolated under `src/debug` and is imported only by Node tests. A future DevEco debug product may inject it for Previewer work. Production code must use an official Wear Engine adapter and official Lite storage implementation.

## Commands available now

Run from `huawei-watch-app`:

```powershell
npm test
npm run format:check
npm run check
```

No npm dependencies are installed or downloaded. Tests use the Node built-in test runner.

## Expected connection check

With a future official transport adapter, the page flow is:

1. Start disconnected and load persisted control state.
2. Connect through the transport adapter.
3. Send `SYNC_REQUESTED` after every successful connection or reconnection.
4. Send `PING` when the user presses the ping button.
5. Accept one matching `PONG`, update the last-pong timestamp, and remove the pending ping.
6. Ignore a redelivered message ID after its receipt has been persisted.

See `../docs/huawei-watch-gt4-capabilities.md` and `../docs/huawei-development-environment.md` for official capability and environment evidence.
