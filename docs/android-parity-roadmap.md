# Android and PWA parity roadmap

## Target

GymCoach should expose one complete responsive interface across the browser,
installed PWA and Android APK. The Android package uses the web interface as
the primary experience and keeps the native Room client as a reliable workout
fallback when cached web state is unavailable.

The target offline boundary is:

- fully offline: open the application, start or resume a workout, record,
  edit and delete strength or cardio sets, use timers and local calculators,
  finish the session and synchronize later;
- offline read cache: active program, history, progress, exercise catalog and
  media, settings, coach history and chat history;
- queued until online: readiness, bodyweight and measurement writes where
  conflict handling is deterministic;
- online-only execution: LLM coach replies, chat replies, AI program
  generation, imports, backup restore and MCP operations.

## Phase 1: shared interface and updates

- Open the full web interface as the Android start destination.
- Allow the embedded WebView to reuse PWA and HTTP caches while offline.
- Keep the native Room workout screen available through the Android back
  action.
- Support system dark mode in native fallback screens.
- Publish a versioned APK with SHA-256 metadata.
- Add an Android download section to web settings and an update action inside
  Android.

## Phase 2: complete offline workout lifecycle in the PWA

- Scope IndexedDB and Workbox data by authenticated user and server origin.
- Clear or switch local data safely during logout and account changes.
- Store the mobile bootstrap locally instead of relying only on cached server
  components.
- Replace the set-only Dexie queue with the idempotent mobile operations:
  `START_SESSION`, `UPSERT_SET`, `DELETE_SET` and `FINISH_SESSION`.
- Make new-session and active-session routes reopen reliably without a network.
- Add conflict and blocked-operation UI matching the native outbox behavior.
- Add production PWA E2E tests for cold offline launch and reconnect sync.

## Phase 3: offline read parity

- Cache normalized history sessions and details.
- Cache progress aggregates and render existing charts from local snapshots.
- Cache programs, the exercise catalog and media required by the active
  program.
- Cache coach and chat history while clearly marking new AI requests as
  waiting for connectivity.

## Phase 4: broader offline mutations

- Add deterministic outbox operations for readiness, bodyweight,
  measurements, goals and volume targets.
- Keep complex program editing online until conflict rules are specified.
- Add background sync where the browser and Android WebView support it, with
  foreground retry as the guaranteed fallback.

## Verification matrix

Every parity batch should cover:

- public HTTPS and LAN origins;
- first online bootstrap followed by airplane mode;
- cold application restart while offline;
- add, edit, delete and finish operations followed by reconnect;
- Russian and English locales;
- light, dark and system themes;
- small phone and Pixel-class screen sizes;
- screenshot comparison for the main tabs and workout states.
