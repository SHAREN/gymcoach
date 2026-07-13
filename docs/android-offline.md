# GymCoach Android offline architecture

Status: implementation contract for the native Android client.

## Product behavior

The Android application is a native Kotlin application, not a packaged web
page. After the first authenticated bootstrap it can start or resume a cached
workout without internet access. The trainee can record, edit and delete sets,
including weight, repetitions, RIR and notes, finish the session, record
session RPE and receive the deterministic next-set recommendation locally.

The web panel remains available inside the application when the server can be
reached. MCP and LLM features are online-only. Their absence must never prevent
recording or finishing a native workout.

## Local source of truth

Room is the source of truth during a workout. The local database stores:

- the latest server bootstrap needed to render the active program;
- open sessions created locally or imported from the server;
- completed set records and local deletion tombstones;
- an ordered synchronization outbox.

The UI observes Room flows. A successful network request is not required before
a local set appears or before the next-set calculation can run.

Client-generated session and set IDs are the final server IDs. This avoids ID
remapping and makes a repeated upload safe.

## Ordered outbox

Every mutation is saved in the same Room transaction as the local entity
change. Supported operations are:

- `START_SESSION`;
- `UPSERT_SET`;
- `DELETE_SET`;
- `FINISH_SESSION`.

Each operation has a unique client-generated `operationId`. The server stores a
hash and result for every applied operation in `MobileMutation`. Repeating the
same ID and payload returns `DUPLICATE`; reusing the ID for a different payload
is rejected.

The client sends at most 500 operations per request and drains additional
batches in sequence. Only one synchronization run may execute in the process at
a time. A rejected operation becomes the blocked queue head and later
operations remain pending instead of bypassing it. The home screen exposes the
rejection and lets the trainee retry it or explicitly discard it. Discarding a
rejected session start also removes that unsynchronized local session and its
dependent operations. Network failures retain operations for WorkManager retry.

## Bootstrap reconciliation

Server bootstrap data is authoritative only for entities without an unsynced
local mutation. Before importing open sessions, the client decodes the complete
outbox and protects every referenced session and set. This prevents a refresh
from replacing an offline edit, reviving a locally deleted set or reopening a
locally finished session.

For unprotected open sessions, bootstrap reconciliation also removes local sets
that no longer exist on the server and removes sessions that were finished
elsewhere. If an outbox row cannot be decoded, reconciliation stops rather than
risk overwriting local work.

## Scheduling and recovery

WorkManager schedules:

- an immediate network-constrained sync after each local mutation;
- a periodic network-constrained sync every 15 minutes;
- an immediate sync when the application starts with a stored account.

The server journal makes a retry safe even if the server committed a request
and the phone lost connectivity before receiving the response. The local row is
removed only after `APPLIED` or `DUPLICATE` is received.

Signing out is disabled while the outbox is not empty. This prevents an offline
workout from being erased before upload.

## Authentication and web panel

The Android API uses a revocable `gma_` bearer token with a 180-day lifetime.
The raw token is encrypted with an Android Keystore AES-GCM key. Production
builds require HTTPS; debug builds permit HTTP only for localhost, the Android
emulator host and private LAN addresses.

For the online web panel, the mobile token is exchanged for the standard
GymCoach web session cookie. The WebView disables file and content access,
blocks mixed content, rejects third-party cookies and sends external hosts to
the system browser.

## Local calculation parity

`android/.../training/Autoregulation.kt` is the Kotlin port of
`lib/intra-set-autoregulation.ts` and the gym load constraints used by the web
application. It supports `PRESERVE_RIR`, `PRESERVE_REPS`, actual recovery time,
same-primary-muscle supersets, readiness and deload increase blocks,
return-to-training ceilings and the active gym inventory.

Missing RIR lowers recommendation confidence. No offline calculation invokes an
LLM or invents a replacement for missing data.

## Build and verification

Required local toolchain:

- JDK 17;
- Android SDK platform 35;
- Android build tools 35.0.0.

From `android/`:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

The debug APK is produced at
`android/app/build/outputs/apk/debug/app-debug.apk`.
