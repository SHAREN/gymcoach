# GymCoach watch wire protocol

This directory is the versioned, implementation-neutral contract between the
GymCoach Android application, the Huawei watch application, and development
simulators.

## Versioning

- Current protocol schema version: `v1`.
- Wire envelope version fields are `protocolVersion: "1.0"` and
  `schemaVersion: 1`.
- JSON Schema dialect: Draft 2020-12.
- Schema identifiers use `https://gymcoach.local/contracts/watch/v1/...`.
- `ControlMessage`, `WatchEvent`, `SyncAck`, `SyncSnapshot`, `BatchEnvelope`,
  `FileTransferEnvelope`, and `SensorBatch` carry both wire version fields.
  Nested domain projections such as `ActiveWorkoutRuntime` are versioned by the
  enclosing schema and do not repeat them.
- Schemas are strict (`additionalProperties: false`). Any field, enum, or
  semantic change requires a new schema version; implementations must not add
  undeclared fields to v1 payloads.
- Unknown protocol versions must be rejected with a diagnostic error. They must
  not be silently interpreted as the current version.

## Transport limits

- Direct peer-to-peer JSON messages must be at most 1,024 UTF-8 bytes.
- Larger event groups and snapshots use chunked or file transfer.
- Every chunked/file payload must be smaller than 4,000,000 UTF-8 bytes.
- GymCoach targets at most 3.5 MiB for the complete serialized file so the
  transport envelope and implementation overhead do not approach the hard
  limit.
- `BatchEnvelope.deliveryMode` declares whether an envelope is a direct `P2P`
  message or a `FILE` payload.
- `FileTransferEnvelope.byteLength` and `sha256` cover the UTF-8 canonical JSON
  bytes of `payload`, not the formatted envelope file. The complete serialized
  file, including the envelope, must still remain below 4,000,000 bytes.
- Sensor samples should be buffered and sent in batches. Do not send one
  message for every UI frame or sensor callback.
- `SensorBatch` is the normative batch/file payload for raw samples. It keeps
  invalid readings explicit and never substitutes zero for a missing value.
- Heart-rate summaries select the nearest valid boundary/30-second/60-second
  sample with an earlier-sample tie break and exclude invalid samples from all
  aggregates.

These are protocol operating limits. An implementation must also enforce any
stricter limit reported by the installed Huawei SDK/runtime.

## Control plane and workout plane

`ControlMessage` is the small pre-session and diagnostic envelope used by the
Stage 2 transport check. It supports only `PING`, `PONG`, `SYNC_REQUESTED`, and
`SYNC_SNAPSHOT`. Its serialized P2P form must remain at most 1,024 bytes, with a
GymCoach engineering target of at most 900 bytes.

- `messageId` is a unique opaque non-empty string of at most 128 characters. It
  is intentionally not restricted to UUID syntax so Lite Wearable code can use
  a deterministic local ID generator.
- `deviceId` is a non-empty pseudonymous identifier of at most 128 characters.
- `replyTo` contains the request `messageId` when a control message is a direct
  response, or `null` when it is not a response.
- Control messages do not contain `sessionId`, `eventId`, `revision`, or workout
  mutations. They are not written into the workout event journal and do not use
  `SyncAck`.
- The Stage 2 `SYNC_REQUESTED` and `SYNC_SNAPSHOT` control types exchange only
  transport/protocol diagnostic state before an active workout session is
  established. They must not carry or replace workout session data.

Once a workout session exists, all mutations and session reconciliation remain
`WatchEvent` operations with a stable UUID `eventId`, an opaque existing
`sessionId`, a monotonic `revision`, durable delivery, and `SyncAck` processing.

## Delivery, ordering, and acknowledgement

Domain identifiers are opaque stable strings. Android currently uses prefixed
values such as `mob_session_<hex>` and `mob_set_<hex>`, while server-originated
entities may use a different non-UUID format. Implementations must preserve
these IDs exactly and must not replace them with watch-generated duplicates.
Only protocol-generated identifiers such as `eventId`, `ackId`, `batchId`,
`snapshotId`, `conflictId`, and `sampleId` are UUIDs.
`WorkoutSession.workoutProgramId` maps to the existing
`LocalSessionEntity.workoutId`; its historical field name does not authorize a
second workout or program identifier.
`SetRecord.rir` may be `null` when an existing phone or server set never
recorded RIR. A new set completed on the watch still requires an explicit
integer RIR from 0 to 5.

1. The producer creates a stable UUID `eventId` once and persists the event in
   its local outbox before attempting delivery.
2. The consumer stores processed `eventId` values. Re-delivery of an already
   processed event returns an acknowledgement but does not apply the mutation
   again.
3. Events are ordered by `revision`, then `timestamp`, then `eventId`. Transport
   arrival order is not authoritative.
4. A revision is monotonic within one workout session. A receiver that sees a
   gap requests `SYNC_SNAPSHOT` instead of guessing missing state.
5. `SyncAck.eventIds` acknowledges durable processing, not merely receipt. All
   IDs in one ACK share its `status`; implementations split mixed results into
   separate ACKs. Producers retain unacknowledged events across process restarts
   and reconnects.
6. `SyncSnapshot` reconciles current state plus pending events. Applying it must
   remain idempotent.
7. Divergent edits at the same logical revision create a `ConflictRecord`.
   Neither side silently deletes the other side's data.
8. Batch envelopes use `sequence` and `totalSequences`; sequence numbering is
   one-based. A batch is applied only when all expected sequences are present.
9. `SyncSnapshot.runtimeState` is optional for compatibility with snapshots
   produced before Stage 5. When present, it is the absolute active timer and
   pause projection for the same session and revision.

ACK status behavior:

- `APPLIED` - validated and durably committed.
- `DUPLICATE` - the event was already durably committed and was not reapplied.
- `STALE` - the mutation contains no new state; it remains queued until the
  sender explicitly accepts or resolves the stale result.
- `CONFLICT` - an unresolved concurrent mutation was recorded.
- `REJECTED` - schema, identity, capability, or authorization validation failed.

Only `APPLIED` and `DUPLICATE` automatically remove events from the sender's
outbox. `errorCode` is a sanitized machine-readable string or `null`.

## Canonical JSON and event hashes

Inbox event-ID reuse detection hashes the complete immutable `WatchEvent`
envelope, including `eventId` and `payload`. Canonical JSON is produced as
follows:

1. Recursively sort object keys lexicographically by Unicode code point.
2. Preserve array element order exactly.
3. Serialize strings with standard JSON escaping and serialize booleans and
   `null` with their standard JSON tokens.
4. Accept finite JSON numbers only and serialize them with standard JSON number
   syntax. `NaN`, positive infinity, and negative infinity are invalid.
5. Encode the resulting JSON text as UTF-8 and calculate lowercase SHA-256.

Insignificant whitespace and original object-key order never enter the hash.
Two semantically identical objects with reordered keys must therefore produce
the same digest. The published cross-implementation test vector is in
`fixtures/canonical-event-hash.json`.

The same canonical JSON rules are used for `FileTransferEnvelope.payload`.
`byteLength` is the number of canonical UTF-8 payload bytes and `sha256` is the
digest of exactly those bytes. `sequence` and `totalSequences` are positive,
one-based values, and `sequence` must not exceed `totalSequences`.

## Source and privacy

- Production event sources are `PHONE` and `WATCH`.
- A simulator emits `WATCH` events with a debug-only device identifier; it does
  not introduce a production protocol source.
- Authentication tokens, user profiles, and secrets are never included in watch
  payloads.
- Heart-rate values are workout telemetry, not medical measurements.
- A missing or invalid heart-rate value is represented as `null` or a sample
  with `valid: false`; zero must not be treated as a measured pulse.

## Files

- `schemas/v1/` - authoritative JSON Schemas.
- `examples/` - valid example documents.
- `fixtures/stage3-event-payloads.json` - normative compact payload shapes for
  active exercise and set events.
- `fixtures/stage4-rest-payloads.json` - normative sensor-batch manifest and
  absolute rest event payloads.
- `fixtures/canonical-event-hash.json` - deterministic canonical JSON and
  SHA-256 vector for event-ID reuse detection.
- `test-contracts.mjs` - dependency-free structural and protocol-limit checks.

Run the checks with Node.js 20 or newer:

```shell
node shared-contracts/test-contracts.mjs
```
