# GymCoach Android offline architecture

Status: implementation contract for the native Android client.

## Product behavior

The Android application uses the complete responsive GymCoach web interface as
its primary screen. This keeps history, progress charts, coach, chat, programs,
exercise media and settings visually identical to the installed PWA. The
embedded WebView may reuse production PWA caches when the server is temporarily
unreachable.

A native Kotlin and Room workout client remains available as the reliable
offline fallback. After the first authenticated bootstrap it can start or
resume a cached workout without internet access. The trainee can record, edit
and delete sets, including weight, repetitions, RIR and notes, finish the
session, record session RPE and receive the deterministic next-set
recommendation locally. The active exercise card also exposes the native
workout-plan actions available on the web: target sets and repetitions, drop
sets, supersets, program notes, replacement, removal and exercise information.
The vertical action trigger opens one scrollable Material 3 bottom sheet. Its
header separates the wrapping exercise name from the muted equipment subtitle;
parameter rows, ordinary actions and the destructive remove action have
separate semantic sections and normal touch targets. Parameter subflows and the
existing remove confirmation preserve their prior mutation contracts.
Exercise addition remains a separate terminal `+` tile in the exercise strip.
The bootstrap carries the same initial prescription used by the web add flow,
so Android does not maintain a second set of hard-coded defaults. The selected
thumbnail stays fully vivid; inactive thumbnail images use a short GPU alpha
transition while status, completion and superset indicators remain undimmed.

Completed strength sessions opened from native History use the same
`StrengthSetEditor` as an active workout in an explicit `FINISHED_EDIT` mode.
That mode can correct weight, repetitions, RIR and supported equipment, delete
a set with confirmation, or append a set to an exercise already retained in
the session. It preserves frozen equipment snapshots unless equipment is
explicitly replaced, validates new loads against the current linked inventory,
and refreshes server-derived counts, volume and e1RM after every successful
mutation. Historical mutations require a live server connection and use the
owner-scoped PATCH, DELETE and idempotent historical-add routes; they never
enter the active workout outbox. The session remains finished and the editor
does not expose rest timers, recommendations, auto-advance or target changes.

MCP, LLM coach replies and AI program generation are online-only. Their absence
must never prevent recording or finishing a native workout. Cached coach and
chat history may be displayed offline, while new requests can only be answered
after the server becomes reachable.

## Local source of truth

Room is the source of truth during a workout. The local database stores:

- the latest server bootstrap needed to render the active program;
- open sessions created locally or imported from the server;
- completed set records and local deletion tombstones;
- an ordered synchronization outbox.

The UI observes Room flows. A successful network request is not required before
a local set appears or before the next-set calculation can run.

After a working set is stored, native workout navigation uses the effective
session target for each exercise. It alternates only to incomplete members of
the current superset, advances past a completed group to the next incomplete
exercise, and wraps to an earlier exercise only when unfinished work genuinely
remains. Completion ignores deleted rows, warm-ups, drop sets and duplicate
representations of the same set. A fully complete workout stays in its completed
state so Finish is the natural action.

Client-generated session and set IDs are the final server IDs. This avoids ID
remapping and makes a repeated upload safe.

## Ordered outbox

Every mutation is saved in the same Room transaction as the local entity
change. Supported operations are:

- `START_SESSION`;
- `UPSERT_SET`;
- `DELETE_SET`;
- `DELETE_SESSION`;
- `FINISH_SESSION`;
- `UPDATE_TARGET_SETS`;
- `UPDATE_PREFERRED_EQUIPMENT`;
- `REPLACE_PROGRAM_EXERCISE`;
- `MUTATE_WORKOUT_EXERCISES`.

Active-workout add, remove, replace, reorder, target, note and superset changes
first update a session-scoped Room draft. The active workout and watch read that
draft, while the cached program remains unchanged. Finishing the session always
saves its factual history. If the draft differs from the starting prescription,
Android keeps a recoverable decision and asks whether to save the structural
changes to the program or keep them only in that completed workout.

Choosing Save to program creates one `MUTATE_WORKOUT_EXERCISES` compare-and-swap
operation marked as a finished-workout program decision. Its payload contains
both the previous and intended exercise lists, so a stale, deleted or changed
program is rejected rather than partially applied. Replaying an already-applied
payload is idempotent. Choosing Only this workout creates no program mutation.
In both cases completed sets remain tied to their original exercise and frozen
per-set equipment snapshot. The per-gym preferred equipment setting keeps its
existing immediate durable contract. It is not a `ProgramExercise` field, is
excluded from this final diff, and is not reverted by either choice.

Each operation has a unique client-generated `operationId`. The server stores a
hash and result for every applied operation in `MobileMutation`. Repeating the
same ID and payload returns `DUPLICATE`; reusing the ID for a different payload
is rejected.

The client sends at most 500 operations per request and drains additional
batches in sequence. Only one synchronization run may execute in the process at
a time. An HTTP 4xx response for a multi-operation request is isolated with
single-operation replay because request-schema validation is atomic and applies
none of the original batch. The exact permanent failure becomes `BLOCKED`.
Later operations with the same session, set, workout, program-exercise or
preferred-equipment ordering key remain pending, while unrelated operations
continue syncing. This prevents one incompatible legacy operation from blocking
independent workouts or settings changes without violating causal ordering.

Database migration 10 to 11 normalizes legacy Kotlin class names in the outbox
type column to the stable wire discriminators above. A row previously blocked
by the server's `Invalid discriminator value` schema response is retried once
under the new isolating engine. If the server still does not support that wire
operation, only that row returns to `BLOCKED`; it does not enter an automatic
retry loop or stop unrelated rows. The home screen exposes blocked changes for
explicit retry or discard. Discarding a rejected session start also removes
that unsynchronized local session and its dependent operations. Network
failures retain operations for WorkManager retry.

## Bootstrap reconciliation

Server bootstrap data is authoritative only for entities without an unsynced
local mutation. Before importing open sessions, the client decodes the complete
outbox and protects every referenced session and set. This prevents a refresh
from replacing an offline edit, reviving a locally deleted set or reopening a
locally finished session.

Pending workout-plan operations are reapplied over each refreshed bootstrap in
outbox order. A rejected atomic workout mutation rolls the cached plan and
active-exercise runtime back together; retry restores the intended state only
when the authoritative previous list still matches, while discard keeps the
authoritative server plan.

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

The bootstrap precomputes equipment-scoped return recommendations for every
owned gym, including gyms that do not yet have an open server session. Web and
Android apply the same session target RIR and weight ceiling before equipment
rounding. If the scoped recommendation is missing from an old or incomplete
bootstrap, the native client does not produce or prefill a next-set
recommendation from unrestricted program targets; it waits for refreshed
shared state instead of bypassing a possible return ceiling.

Bootstrap schema 9 adds a compact long-term strength summary for each exact
exercise. It separates familiarity with the movement from confidence in the
load on a concrete equipment ID and includes only aggregate anchors, counts and
dates. Android still receives at most 12 raw display-history sessions. Legacy
sets without an equipment ID may seed a conservative same-exercise calibration
start, while explicit other-machine or stale/deleted equipment snapshots never
become exact-equipment load history. Equipment-only calibration uses at most
the first two valid bound working sets at RIR 3 or higher, then the card closes
and the active runner uses those equipment-scoped sets.

The active workout's previous-performance display selects the latest completed
session by exact `exerciseId` from those raw display-history sessions. A
different, deleted or unrecorded `gymEquipmentId` never hides that session.
Frozen equipment names are shown when available, and the UI labels unrecorded
or different-equipment provenance. This display contract is intentionally
separate from equipment-scoped return recommendations, calibration, confidence,
load ceilings and plate/load calculations.

Missing RIR lowers recommendation confidence. No offline calculation invokes an
LLM or invents a replacement for missing data.

During an active workout, a return or equipment-calibration recommendation can
seed the initial regular-set count. Once the user explicitly changes that count
from either the set-table `#` control or Exercise parameters, Android stores a
session-scoped override in Room and updates the existing `ProgramExercise`
through the idempotent offline sync operation. The session override remains
authoritative across navigation, bootstrap refresh, process restart and
equipment changes for planned rows, progress, completion, summary and
auto-advance. It changes only set count: return/calibration weight ceilings,
target RIR and equipment confidence remain in force. A count cannot be reduced
below already completed regular and drop-set rows.

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

## Self-hosted APK publishing

Every successful debug APK build automatically publishes the latest APK and
its validated metadata. From `android/`, this is sufficient:

```powershell
.\gradlew.bat assembleDebug
```

The `assembleDebug` task depends on `publishDebugApk`, which only runs after a
successful `packageDebug` and then invokes the repository publisher. To
republish an already-built APK manually from the repository root, use:

```powershell
npm run android:publish-apk
```

The command copies the APK to an immutable, hash-qualified filename such as
`data/android-release/gymcoach-2-a5bb6be092ce.apk` and atomically replaces
`data/android-release/latest.json` with the version code, version name, size,
publication time, SHA-256 digest and current filename. Generated files are
ignored by Git.

The web application exposes two public same-origin endpoints:

- `/api/android/latest` for version and digest metadata;
- `/api/android/download` for the APK download.

Because the web settings page uses a relative URL, the same link works through
the public HTTPS hostname or through the LAN address used to open GymCoach. The
Android client builds the URL from the server address saved at login.

`docker-compose.prod.yml` mounts `data/android-release` read-only into the app
container. An APK must always be signed with the same persistent Android
signing key as the installed application. Android rejects an update signed by
a different key even when the package name is unchanged.
