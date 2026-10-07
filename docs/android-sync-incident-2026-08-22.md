# Android sync incident — stale `UPDATE_PREFERRED_EQUIPMENT` queue item

Date investigated: 2026-08-22

This document is the restart point for the Android synchronization error shown in the GymCoach Android app. Read it before changing the mobile sync protocol, Android recovery logic, or deploying a server image.

## User-visible symptom

Android shows a red card saying synchronization requires attention. The card reports that one change is incompatible/invalid and identifies the problematic action as saving preferred equipment. The app reports 12 pending changes.

The attached error report was generated at 2026-08-22 17:02:10 +05:00 from Android app 0.4.49 (59), source commit `6b826b5fef5c`, running on Google Pixel 7 Pro / Android 16.

Important report facts:

- category: `CLIENT_SERVER_INCOMPATIBLE`
- retryable: `false`
- recovery action: `UPDATE_APP`
- data state: `QUEUED_LOCALLY`
- HTTP status: 400
- blocked operation id: `op_b42b0994a9ae47d5a0e276210bd5a4e9`
- blocked operation type: `UPDATE_PREFERRED_EQUIPMENT`
- blocked item created: `2026-07-29T19:21:56.021Z`
- attempts: 4
- pending queue count in the report: 12

The server response stored by Android was:

`Invalid discriminator value. Expected 'START_SESSION' | 'UPSERT_SET' | 'DELETE_SET' | 'DELETE_SESSION' | 'UPDATE_TARGET_SETS' | 'FINISH_SESSION'`

The report intentionally does not include the operation payload, so the exact gym/exercise/equipment IDs of the blocked local item are currently unknown.

## Root cause in plain language

Android had a newer kind of synchronization action: **save the preferred piece of equipment for an exercise in a gym**.

At the moment when this old queue item was rejected, the server accepted only an older list of sync actions. The Android app sent `UPDATE_PREFERRED_EQUIPMENT`; the server parser rejected the request before any database write because that action name was not in its allowed list.

So the local change was never applied to the server and remained on the phone.

The Android error classifier then made a second mistake: it interpreted this situation as **the Android app being too old** (`recoveryAction = UPDATE_APP`) and marked it non-retryable. In reality, for this error the opposite was true: the server was older than the client operation protocol.

That means the app can keep an old item permanently blocked even after the server later becomes capable of accepting the operation.

## Evidence that the operation itself is valid

Production PostgreSQL contains successfully applied `UPDATE_PREFERRED_EQUIPMENT` mobile mutations from the same Pixel 7 Pro device id (`83c1a6b3-2813-48da-b156-2d2b7a72a021`):

- `op_4d421a8852534cafb63208af6a965271` — applied 2026-08-09 14:10:54 UTC
- `op_3ec450ef3ecc4dec80fe6b547aefa693` — applied 2026-08-13 10:50:14 UTC

Both returned successful `GYM_EXERCISE_CONFIG` results with a concrete `preferredEquipmentId`.

Therefore:

1. the server has had a correct implementation of this operation;
2. the same physical Pixel 7 Pro successfully used it later;
3. the old July 29 queue item is a stale recovery problem, not proof that preferred-equipment saving is fundamentally broken.

## Server regression found on 2026-08-22

The server image deployed earlier on 2026-08-22 for the MCP `create_gym` change (`gymcoach-app:create-gym-20260822`, image `58d7fe502245`) was built from an older source snapshot.

Its compiled `/api/mobile/sync` accepted only the old basic mobile operations and did **not** contain the newer production mobile logic.

The previous production image (`gymcoach-app:pre-create-gym-20260822`, image `26de81844ca0`) contains the newer mobile sync implementation, including the exact switch case:

`UPDATE_PREFERRED_EQUIPMENT`

It also contains the later production schema/features such as preferred equipment, equipment-first inventory, plate pools, equipment snapshots, session exercise membership, etc.

Thus the `create_gym` deployment accidentally downgraded the mobile server API even though the PostgreSQL database remained on the newer schema.

## Immediate mitigation performed

On 2026-08-22 around 17:07 local time the application container was rolled back to the previous compatible image:

- `gymcoach-app:latest` was pointed back to image `26de81844ca0` (`pre-create-gym-20260822`)
- the broken newer image was additionally tagged `gymcoach-app:broken-mobile-create-gym-20260822`
- only `gymcoach-app` was recreated
- `gymcoach-db` was not restarted
- production PostgreSQL data was not modified
- migration deploy reported `37 migrations found` and `No pending migrations to apply`
- server started normally on Next.js 15.5.19

The currently running server was verified to contain `UPDATE_PREFERRED_EQUIPMENT` in its compiled mobile sync handler.

## Current unresolved part

The specific blocked operation id `op_b42b0994a9ae47d5a0e276210bd5a4e9` is still absent from the server `MobileMutation` table after server rollback.

This is expected if Android has persisted the previous error as non-retryable and refuses to resend that old queue item. The report shows exactly that state: `retryable=false` and `recoveryAction=UPDATE_APP`.

The installed Android 0.4.49 source was later recovered from the Codex manual-sequential clone and imported into the main repository as the archival ref `archive/codex-manual-sequential-v0.4.49`. The exact release commit is `6b826b5fef5c1a4962b66f9d379010083b75d3bd` (`v0.4.49`, versionCode 59).

The exact client-side dead end is now proven in source. In `GymCoachRepository.retryBlockedChange()`, ordinary blocked items return immediately when the reconstructed error has `retryable=false`. In `AppError.kt`, `CLIENT_SERVER_INCOMPATIBLE` is deliberately excluded from the retryable categories and is mapped to `UPDATE_APP`. Therefore a server that was temporarily too old can later become compatible, while the already-blocked local operation still has no path to be sent again.

The fix should add a distinct compatibility re-check path (manual and/or capability/version-driven) without turning all validation/schema errors into infinite automatic retries. See `docs/codex-history-handoff-2026-08-22.md` for the recovered release line and exact source locations.

Do not delete the blocked queue item blindly until its payload/current server state is reconciled or the Android recovery code is fixed to retry it.

## Required permanent Android fix

The Android recovery logic must distinguish the direction of client/server incompatibility.

For an HTTP 400 whose server response says the operation discriminator/type is unknown, such as:

`Invalid discriminator value. Expected ...`

Android should **not** permanently classify the item as `UPDATE_APP` + non-retryable. This usually means **server protocol too old for this client operation**.

Recommended behavior:

1. keep the local operation intact;
2. classify it as a server-capability/protocol mismatch;
3. allow a manual `Retry` / `Re-check server` action;
4. retry after successful bootstrap/capability refresh or after the server version changes;
5. do not require deleting the operation to recover;
6. if the operation is later superseded by a newer operation for the same gym/exercise, allow safe compaction only after comparing payload semantics;
7. the error card should explain whether the client or server is older instead of always saying to update Android.

A capability/version handshake between Android and `/api/mobile/bootstrap` would make this robust. At minimum, the server can expose supported mobile operation types/protocol version and Android can clear stale incompatibility blocks when that version changes.

## Required permanent server/deployment fix

The upstream-sync branch currently lacks several later production-only source/schema changes. Do not build another production image from that branch until the production-only code and migration history are restored/reconciled.

Before redeploying `create_gym` or upstream changes:

1. restore the later production schema/code documented in `docs/upstream-sync-2026-08-22.md`;
2. preserve the newer mobile sync handler, including `UPDATE_PREFERRED_EQUIPMENT` and the other post-0.1 operations;
3. add a regression test asserting the server accepts every mobile operation type emitted by the current Android app;
4. preferably add a protocol-version/capabilities test shared between Android and server;
5. run Android/server integration tests against a copy of production DB;
6. only then replace the current compatible production image.

## How to verify the incident is finally cleared

The blocked operation id is:

`op_b42b0994a9ae47d5a0e276210bd5a4e9`

After Android retries successfully, this exact id should appear in production table `MobileMutation` and the local pending count should decrease.

Read-only DB check:

```sql
SELECT "operationId", "type", "createdAt", "result"
FROM "MobileMutation"
WHERE "operationId" = 'op_b42b0994a9ae47d5a0e276210bd5a4e9';
```

If it remains absent, the phone has not resent it.

## Related checkpoint

Also read `docs/upstream-sync-2026-08-22.md`. The accidental mobile API downgrade is another concrete consequence of the production-only source/migrations that were missing from the rebased upstream-sync tree.
