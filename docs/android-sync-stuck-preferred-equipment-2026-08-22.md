# Android sync queue blocked by UPDATE_PREFERRED_EQUIPMENT — 2026-08-22

## User-visible symptom

Android GymCoach shows a persistent red banner:

- "Синхронизация требует внимания"
- pending queue count: 12
- problem action: saving preferred equipment
- the problem has persisted since the previous week

The captured error report was generated at 2026-08-22 17:02:10 +05:00 from Android app 0.4.49 (59), source commit `6b826b5fef5c`, on a Pixel 7 Pro / Android 16.

## Exact blocked queue item

The Android report identifies:

- blocked queue item: `op_b42b0994a9ae47d5a0e276210bd5a4e9`
- operation type: `UPDATE_PREFERRED_EQUIPMENT`
- created: `2026-07-29T19:21:56.021Z`
- attempt count: 4
- pending queue count: 12
- data state: `QUEUED_LOCALLY`
- HTTP response: 400
- Android classified it as `CLIENT_SERVER_INCOMPATIBLE`
- Android classified it as `retryable: false`

The server response captured by Android was:

`Invalid discriminator value. Expected 'START_SESSION' | 'UPSERT_SET' | 'DELETE_SET' | 'DELETE_SESSION' | 'UPDATE_TARGET_SETS' | 'FINISH_SESSION'`

That proves the server receiving the request at 17:02 did not accept `UPDATE_PREFERRED_EQUIPMENT` in its incoming mobile-sync request schema.

## Root cause found

This was a server regression caused by an incomplete deployment, not bad workout data.

Earlier on 2026-08-22, the `create_gym` server feature was deployed from an isolated/older source tree. That build did not include all of the production-only Android/mobile work which had been developed after the branch snapshot used to build it.

One of the missing API additions was support for the Android sync operation:

`UPDATE_PREFERRED_EQUIPMENT`

Therefore the Android app, which was newer than that temporary server build, queued a perfectly valid operation and sent it to a server whose request validator only knew the older set of operation types. The request was rejected with HTTP 400 before it could reach the operation handler.

This explains why the problem appeared to "follow" the user for days: the operation remained safely stored in the Android local queue and blocked later queued changes from being sent in order.

## Evidence that the server is now capable of handling it

At approximately 17:07 local time on 2026-08-22 the running `gymcoach-app` container was recreated using the previous production image (`gymcoach-app:pre-create-gym-20260822`, image sha beginning `26de81844ca0`).

Inspection of the currently running production Next.js bundle shows BOTH:

1. the mobile request schema explicitly allows `UPDATE_PREFERRED_EQUIPMENT` with:
   - `gymId`
   - `exerciseId`
   - nullable `preferredEquipmentId`
2. the mobile sync transaction handler contains a `case "UPDATE_PREFERRED_EQUIPMENT"` and calls the preferred-equipment update logic.

So the server-side incompatibility that caused the captured 17:02 error is no longer present in the currently running server image.

## Why the red error can still remain after the server is fixed

Android recorded this specific failure as:

- `retryable: false`
- recovery action: `UPDATE_APP`

That is understandable for a genuine permanent client/server incompatibility, but it is wrong for this recovery scenario: the server can later be upgraded or rolled back to a compatible version while the same Android queue item remains valid.

Because the item was classified as non-retryable, the client may keep it as the queue blocker and never automatically send it again even after the server becomes compatible. That is the likely reason the user can still see the red card even though the currently running server now supports the operation.

The error report shows `lastRetryAtUtc: null`, reinforcing that the item is not being treated as a normal transient retry after it entered the blocked state.

## Data-safety conclusion

Do NOT simply delete the queue item as the first recovery action.

The queue state says `QUEUED_LOCALLY`, so the Android client still holds the unsent change. The server-side operation is idempotent through the mobile mutation journal once accepted. The preferred recovery is therefore to retry the same queued operation against the now-compatible server, preserving the user's choice and then allowing the remaining 11 queued items to continue.

Only discard the item if it is confirmed semantically obsolete and the user explicitly chooses to lose that change.

## What still needs to be fixed in Android

The installed APK is app 0.4.49 (59), source commit `6b826b5fef5c`. That source commit is not currently reachable in the local Git repository after the upstream-reconciliation work, so the exact client recovery code has not yet been patched at this checkpoint.

Required Android behavior change:

1. A 400 `CLIENT_SERVER_INCOMPATIBLE` failure must not permanently brick the queue forever.
2. The app should allow an explicit "Retry now" once the server may have changed.
3. On app foreground/manual sync, a previously blocked schema-incompatibility item should be eligible for a fresh capability/retry check rather than being permanently skipped.
4. If the retry succeeds, clear the blocked error and continue the remaining queue in order.
5. If it fails with the same incompatibility again, keep the item and show the current error without deleting user data.
6. The existing "delete problematic change" path should remain a last-resort user action, not the normal recovery from a temporary server rollback.

A stronger future design would expose a mobile API/capability version from the server so Android can distinguish "server is temporarily older" from "this operation will never be understood" and automatically retry after capability changes.

## Deployment rule learned from this incident

Never deploy a partial/isolated server build over production merely to add one feature when production contains later local work that is not present in that source tree.

Before any future GymCoach server deployment:

1. compare the candidate source against the currently running production schema/API features;
2. verify all production-only migrations and mobile operation types are represented;
3. run mobile API compatibility tests;
4. deploy only the fully reconciled tree.

This rule is especially important until the upstream migration/schema reconciliation described in `docs/upstream-sync-2026-08-22.md` is complete.

## Current status at checkpoint

- Root cause: identified.
- User workout/set data corruption: no evidence of corruption.
- Blocked local queue item: still must be retried/recovered on the Android device.
- Current production server: supports `UPDATE_PREFERRED_EQUIPMENT` again.
- Android recovery logic: not yet patched because the exact source tree for installed app 0.4.49 (59) is not currently reachable in Git.
- Production database: not modified during this investigation.
