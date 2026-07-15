# Huawei watch synchronization protocol

Status: protocol contract. Schemas in `shared-contracts/` are normative for serialization; this document is normative for delivery, ordering, reconciliation, and conflict behavior.

## Goals

The protocol synchronizes one active GymCoach session between the Android phone and Huawei watch while either device can be temporarily offline. It provides durable delivery, idempotent application, revision reconciliation, explicit conflict records, bounded messages, and batched sensor transfer.

The phone remains the long-term server bridge. The watch is an autonomous recorder for the active session and its unacknowledged events. The watch never receives the GymCoach bearer token.

## Versioning

The normative v1 wire envelopes are `ControlMessage`, `WatchEvent`, `SyncAck`,
`SyncSnapshot`, and `BatchEnvelope`. Each includes:

- `protocolVersion`: the exact string `"1.0"`.
- `schemaVersion`: the exact integer `1`.

Nested domain projections such as `WorkoutSession`, `ExerciseSession`,
`SetRecord`, and `SensorSample` are versioned by the enclosing wire schema and do
not repeat these fields. All v1 schemas use `additionalProperties: false`, so an
unknown field, event type, protocol version, or schema version is rejected with
a sanitized diagnostic result. A receiver must not attempt a best-effort decode.
Any future field or enum addition requires a new schema version and explicit
compatibility handling.

## Pre-session control messages

`ControlMessage` is a separate, small control-plane envelope for the Stage 2
connection check and pre-session diagnostics:

```json
{
  "protocolVersion": "1.0",
  "schemaVersion": 1,
  "messageId": "stage2-ping-001",
  "type": "PING",
  "timestamp": 0,
  "source": "WATCH",
  "deviceId": "watch-gt4-stage2",
  "replyTo": null,
  "payload": {}
}
```

Its type is one of `PING`, `PONG`, `SYNC_REQUESTED`, or `SYNC_SNAPSHOT`.
`messageId` and a non-null `replyTo` are opaque non-empty strings with a maximum
length of 128 characters. `deviceId` is a non-empty pseudonymous identifier with
the same 128-character limit. A `PONG` normally uses `replyTo` to reference the
corresponding `PING` ID.

This envelope is diagnostic and pre-session only. It has no `sessionId`,
`eventId`, `revision`, or ACK state, is not inserted into the workout outbox or
inbox, and cannot create, edit, finish, or reconcile workout data. The control
`SYNC_REQUESTED` and `SYNC_SNAPSHOT` values describe only Stage 2 transport and
protocol readiness before an active session is established.

After a workout session exists, session synchronization uses `WatchEvent`,
`SyncSnapshot`, and `SyncAck`. Workout mutations always have a stable UUID
`eventId`, the existing opaque `sessionId`, a monotonic `revision`, durable
idempotent delivery, and an ACK result.

## Event envelope

```json
{
  "protocolVersion": "1.0",
  "schemaVersion": 1,
  "eventId": "uuid",
  "sessionId": "opaque-existing-session-id",
  "type": "SET_COMPLETED",
  "timestamp": 0,
  "source": "WATCH",
  "deviceId": "string",
  "revision": 1,
  "payload": {}
}
```

Required rules:

- `eventId` is generated once and is globally unique.
- `sessionId` is the existing `LocalSessionEntity.id`.
- Session, workout, user, exercise, exercise-session, entity, and set IDs are
  opaque stable strings. Existing prefixed Android IDs and server IDs must be
  preserved exactly; they are not required to be UUIDs.
- `WorkoutSession.workoutProgramId` carries the existing
  `LocalSessionEntity.workoutId`. It is a wire compatibility name, not a second
  program or workout entity.
- Protocol-generated event, ACK, batch, snapshot, conflict, and sample IDs are
  UUIDs.
- `timestamp` is Unix epoch milliseconds and records when the user action occurred.
- `source` is `PHONE` or `WATCH`. A debug simulator uses `WATCH` with a
  debug-only `deviceId`; `SIMULATOR` is not a v1 source value.
- `deviceId` is an app-scoped pseudonymous identifier, not a serial number exposed in logs.
- `revision` is the session revision after applying this event at its source.
- The envelope schema treats `payload` as an object. Before mutation, the typed
  event handler must validate the semantic fields listed in the event catalog;
  the v1 repository does not publish separate per-event payload schemas.

Each sender may also store a monotonically increasing local outbox sequence for
diagnostics. It is not part of v1 and cannot determine cross-device replay
order. Wire replay order is revision, timestamp, then lexical `eventId`.

## Event catalog

| Event                     | Required payload                                                              | Application rule                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `WORKOUT_STARTED`         | Session projection, compact workout plan, `startedAt`                         | Creates or confirms the existing `LocalSessionEntity`; never creates a second session for the same ID.          |
| `WORKOUT_PAUSED`          | `pausedAt`                                                                    | Updates active runtime state. Timers remain timestamp-based.                                                    |
| `WORKOUT_RESUMED`         | `resumedAt`, accumulated pause data                                           | Updates active runtime state without rewriting historical timestamps.                                           |
| `WORKOUT_FINISHED`        | `finishedAt`, optional notes and session RPE                                  | Finishes the existing session through the repository and server outbox.                                         |
| `ACTIVE_EXERCISE_CHANGED` | `exerciseId`, `exerciseSessionId`, order                                      | Updates the active pointer after verifying the exercise belongs to the workout.                                 |
| `SET_STARTED`             | `setId`, `exerciseSessionId`, `setNumber`, `startedAt`                        | Persists active set runtime state; it is not yet a completed `LocalSetEntity`.                                  |
| `SET_UPDATED`             | Complete editable set projection and base revision                            | Upserts the existing stable set ID through the repository.                                                      |
| `SET_COMPLETED`           | Complete `SetRecord`, `completedAt`, sensor summary                           | Upserts `LocalSetEntity`, creates the existing server `UPSERT_SET`, and normally starts rest.                   |
| `SET_DELETED`             | `setId`, deletion timestamp, base revision                                    | Applies the existing set tombstone and server `DELETE_SET`; a concurrent edit creates a conflict.               |
| `REST_STARTED`            | `setId`, `startedAt`, `restEndsAt`                                            | Stores absolute rest timestamps in active runtime state.                                                        |
| `REST_UPDATED`            | `restEndsAt`, reason such as add 15 or add 30                                 | Replaces the absolute end timestamp at the new revision.                                                        |
| `REST_FINISHED`           | `finishedAt`, optional rest sensor summary                                    | Clears active rest after recording its summary.                                                                 |
| `REST_SKIPPED`            | `skippedAt`                                                                   | Clears active rest and records that it was skipped.                                                             |
| `SENSOR_BATCH_RECORDED`   | `batchId`, sequence range, delivery mode, event/sample count                  | Registers a `BatchEnvelope`; content uses file delivery when it does not fit safely in one message.             |
| `HEART_RATE_UPDATED`      | Current valid value, unit, timestamp, phase, validity                         | A throttled UI-status event. Raw samples use sensor batches. Every generated event is still durable until ACK.  |
| `WATCH_CONNECTED`         | App version, protocol versions, capabilities, session revision, pending count | Starts the handshake. Capability values are runtime observations, not promises.                                 |
| `WATCH_DISCONNECTED`      | Last connected timestamp and sanitized reason                                 | Phone-side diagnostic event. It does not finish or pause the workout.                                           |
| `SYNC_REQUESTED`          | Session ID, known revision, last ACK, pending event IDs or range              | Requests replay or a full snapshot when revisions cannot be reconciled incrementally.                           |
| `SYNC_SNAPSHOT`           | `snapshotId`, delivery mode, snapshot revision                                | Announces a separately validated `SyncSnapshot` direct/file payload. It never deletes an unmerged local action. |
| `SYNC_ACKNOWLEDGED`       | `ackId`, acknowledged event IDs, status, revision                             | Journals a processed `SyncAck`; the `SyncAck` envelope remains the normative acknowledgement object.            |

### Stage 3 event payload shapes

The compact Stage 3 payloads are normative and are mirrored in
`shared-contracts/fixtures/stage3-event-payloads.json`:

- `ACTIVE_EXERCISE_CHANGED`: `exerciseId`, `exerciseSessionId`, and one-based
  `order`.
- `SET_STARTED`: `setId`, `exerciseSessionId`, one-based `setNumber`, and
  absolute `startedAt`.
- `SET_UPDATED` and `SET_COMPLETED`: the payload is the complete `SetRecord`
  object directly, without a wrapper field.
- `SET_DELETED`: `setId`, absolute `deletedAt`, and `baseRevision`.

All domain identifiers remain opaque stable strings. Event handlers reject
missing fields, invalid numbers, or timestamps before mutating local state.

## ACK contract

```json
{
  "protocolVersion": "1.0",
  "schemaVersion": 1,
  "ackId": "uuid",
  "sessionId": "opaque-existing-session-id",
  "eventIds": ["uuid-of-received-event"],
  "status": "APPLIED",
  "timestamp": 0,
  "source": "PHONE",
  "deviceId": "string",
  "revision": 12,
  "errorCode": null
}
```

`revision` is the receiver's durably applied session revision. All IDs in one
ACK share its status. A receiver sends separate ACKs when event results differ.
`errorCode` is a sanitized machine-readable string or `null`. Payload hashes are
stored in the receiver's private inbox journal for event-ID reuse detection;
they are not fields of the v1 `SyncAck` wire object.

`status` is one of:

- `APPLIED`: validated and durably committed.
- `DUPLICATE`: the same event ID and payload hash was already committed.
- `STALE`: the event contains no new state and was not applied.
- `CONFLICT`: it overlaps an unresolved concurrent mutation.
- `REJECTED`: invalid schema, session, capability, or authorization context.

An ACK is generated only after the event receipt and resulting state are
committed. A sender automatically deletes an outbox row only for `APPLIED` or
`DUPLICATE`. `STALE`, `CONFLICT`, and `REJECTED` remain visible until explicitly
resolved and do not allow dependent events to bypass the blocked head.

## Durable delivery and idempotency

1. The source commits its local state change and outbox event in one transaction.
2. The transport retries pending events in local sequence order.
3. The receiver inserts `eventId` into an inbox table with a unique index before applying the mutation.
4. If the ID already exists with the same payload hash, it returns the original result as `DUPLICATE`.
5. If the ID exists with a different hash, it returns `REJECTED` with `EVENT_ID_REUSE` and creates a diagnostic conflict.
6. The receiver applies the event and receipt atomically, then sends the ACK.
7. Lost ACKs are safe because redelivery returns `DUPLICATE` without creating a second set or timer.

Stable session, set, event, batch, and sample IDs are generated at the device where the user action occurs. They are never remapped during synchronization.

## Revisions and ordering

Revisions are monotonic per workout session. Entity payloads may include `baseRevision` so concurrent edits can be detected precisely.

Receiver behavior:

1. `revision == localRevision + 1`: apply normally.
2. `revision <= localRevision` and the event is already receipted: return `DUPLICATE`.
3. `revision <= localRevision` and its change is already represented: return `STALE` plus current revision.
4. `revision > localRevision + 1`: retain the event, send `SYNC_REQUESTED`, and do not skip the missing gap.
5. Same `baseRevision` with changes to different stable set IDs: merge both in deterministic ID order, assign new revisions, and ACK both.
6. Same entity and field changed concurrently: create a conflict with both payloads. Do not silently choose a winner.

Timestamps are used for display and forensic ordering, not as the sole conflict
resolver because device clocks can differ. The deterministic v1 wire order for
nonconflicting replay is revision, timestamp, then lexical `eventId`. A private
source-local sequence may help diagnostics but is not available to the other
peer and is not a wire ordering field.

## Conflict policy

Commutative operations are merged automatically:

- Completing different stable set IDs.
- Updating active exercise while completing a different set, if both references remain valid.
- Adding nonoverlapping sensor batches.

Potentially destructive or ambiguous operations create a conflict:

- Editing and deleting the same set.
- Two edits to weight, repetitions, RIR, or notes on the same set from the same base revision.
- Finishing a workout while the other device has an unacknowledged set completion.
- Replacing a snapshot while the receiver has local unacknowledged events not represented in it.

A v1 `ConflictRecord` stores `conflictId`, session and entity identifiers, local
and remote revisions, the complete local and remote `WatchEvent`, detection
time, resolution, and resolution time. Production UI must preserve all user
workout data. Debug UI exposes the journal with redacted device and user
identifiers. Resolution produces a new explicit event; it never edits journal
history in place.

## Reconnection handshake

1. Transport reports connection.
2. Both peers exchange `WATCH_CONNECTED` metadata: protocol version, app version, session ID, current revision, last acknowledged revision, last inbox watermark, and pending count.
3. If revisions are contiguous, each side replays missing events from its outbox.
4. If a peer reports a gap, truncated journal, different session, or incompatible snapshot hash, it sends `SYNC_REQUESTED`.
5. The authoritative phone constructs `SYNC_SNAPSHOT`, but first includes or conflicts every unacknowledged watch action. A snapshot never erases them.
6. The watch commits the snapshot atomically, sends `SyncAck`, and may journal a
   `SYNC_ACKNOWLEDGED` event referencing that ACK.
7. Sensor batch transfer resumes by `batchId` and checksum independently from control-event replay.

Opening the watch app after a phone-started workout runs the same handshake. Loss of Bluetooth changes connection state only. It does not pause timers or prevent local workout commands.

## Message and file limits

The v1 hard limit for a direct peer-to-peer JSON payload is 1,024 UTF-8 bytes.
GymCoach applies a smaller engineering target of at most 900 UTF-8 bytes after
serialization, leaving room for transport metadata.

Every serialized `ControlMessage`, including Stage 2 ping/pong, must satisfy
both the 1,024-byte hard limit and the 900-byte GymCoach target. It is never
promoted to file transfer because it must remain a compact diagnostic message.

Before sending any message:

1. Serialize exactly once using UTF-8.
2. Measure byte length, not JavaScript character count.
3. Send directly only when the byte length is at most 900.
4. Transfer larger payloads as a `BatchEnvelope` file or a file-backed
   `SyncSnapshot` instead of a direct message.
5. Reject an accidentally oversized message locally and record a sanitized diagnostic error.

Every file payload must be smaller than 4,000,000 UTF-8 bytes. GymCoach targets
at most 3.5 MiB per file. Larger exports are split into separately transferred
`BatchEnvelope` objects. `deliveryMode` is `P2P` for direct delivery and `FILE`
for file delivery. `sequence` and `totalSequences` are one-based and identify
the parts of one stable `batchId`.

The receiver writes file content to a temporary location, verifies the transport
length and checksum, validates the complete `BatchEnvelope`, commits all events
atomically, then acknowledges their `eventId` values through `SyncAck`. A
corrupt, missing, or duplicate file cannot partially apply events. A duplicate
valid batch returns the same durable event results.

## Sensor batching

Sensor callbacks follow the supported runtime API rate. They are not each converted into Wear Engine messages. Samples are buffered by session, exercise, set, phase, and sensor type, then flushed on a bounded count, elapsed time, lifecycle checkpoint, set completion, rest completion, or disconnect.

`HEART_RATE_UPDATED` is generated only at a bounded UI cadence and on meaningful phase changes. All raw valid and invalid samples, including timestamp and quality, remain in `SENSOR_BATCH_RECORDED`. Set and rest summaries are calculated from valid samples only.

## Snapshot contents

The v1 `SyncSnapshot` schema contains its wire versions, snapshot and session
IDs, timestamp, source, pseudonymous device ID, revision, one `WorkoutSession`,
arrays of `ExerciseSession`, `SetRecord`, and `SensorSample`, plus pending
`WatchEvent` objects. Active exercise and set pointers and absolute workout
start/finish timestamps are carried by `WorkoutSession`. Absolute rest, pause,
and in-progress set timestamps are replayed from the corresponding pending
events until a dedicated runtime-state projection is introduced in a later
schema version.

A snapshot reconciles state represented by its explicit fields only. It never
implicitly deletes a local set, event, sensor sample, conflict, timer, or
unacknowledged user action that the snapshot does not represent. It is
transferred as a file when its serialized payload exceeds the direct-message
limit or the 900-byte engineering target.

## Privacy and diagnostics

Protocol logs contain event type, pseudonymous device suffix, revision, byte count, latency, status, and sanitized error code. They exclude access tokens, raw payloads, names, notes, full device IDs, raw sensor streams, and personal account data. Diagnostic export hashes session IDs and strips all exercise notes and free text.

## Official references

- [Wear Engine service introduction](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/service-introduction-0000000000018585)
- [Sending a Wear Engine message](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/send-message-0000001052460491)
- [Applying for Wear Engine](https://developer.huawei.com/consumer/en/doc/connectivity-Guides/applying-wearengine-0000001050777982)
