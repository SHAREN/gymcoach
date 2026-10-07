# Discussion draft: ownership model for a native offline GymCoach Android client

Status: local draft only — do not open automatically.

Suggested title: Proposal: ownership model for a native offline GymCoach Android client

## Motivation

A local prototype explored a native Android client for GymCoach focused on reliable workout logging when connectivity is poor or absent. Before proposing code upstream, the repository ownership and API boundary should be agreed with the maintainer because the prototype is large and spans Android UI, local persistence, authentication, sync APIs and server schema changes.

Current `upstream/main` has web/PWA offline UI support, but no native Android source tree or native mobile API/sync surface equivalent to the prototype.

## Prototype capabilities worth discussing

- Native Kotlin/Compose Android application.
- Room-backed local workout/session cache.
- Offline workout logging with a pending-operation queue.
- Background synchronization and recovery after connectivity returns.
- Native authentication/bootstrap against GymCoach.
- Secure local account/token storage.
- Conflict/recovery handling intended to avoid silently losing locally logged sets.
- Tests around repository synchronization and recovery behavior.

This is evidence that the workflow is feasible, not a proposal to merge the prototype as-is.

## Decision needed first

Which ownership model does upstream want?

### Option A — Android client in the GymCoach monorepo

Advantages:
- API and client changes can evolve atomically.
- Shared release/review context.
- Easier integration testing of server/mobile contracts.

Costs:
- Adds Android/Gradle/Kotlin tooling and CI burden to the main repository.
- Expands maintainer scope beyond the existing web application.

### Option B — separate `gymcoach-android` repository

Advantages:
- Keeps Android toolchain, releases and issues isolated.
- Main repository can expose a stable mobile API without owning the client implementation.
- Android can have its own CI/release cadence.

Costs:
- Cross-repository API evolution needs explicit versioning/compatibility discipline.
- Coordinated changes require sequencing across repositories.

### Option C — upstream owns only a documented mobile API

The native client remains downstream/community-owned while GymCoach upstream defines and tests a stable authentication/bootstrap/sync contract. This minimizes upstream client ownership but still enables reliable third-party native clients.

## Suggested architecture boundaries if upstream is interested

1. Define/version the mobile API contract independently of Android UI.
2. Keep authentication/token scope explicit and revocable.
3. Make sync operations idempotent where practical and give client operations stable IDs.
4. Define conflict semantics before accepting offline writes; never silently overwrite newer server state.
5. Keep schema migrations/API additions in focused server PRs rather than coupling them to the entire Android application.
6. Treat local cache as a recoverable replica, not an authority over unrelated server data.
7. Add real integration tests for reconnect, retry, duplicate delivery and partial-failure recovery.

## Proposed incremental path

If the maintainer wants this direction, avoid a single large Android PR. A reviewable sequence could be:

1. Agree on repository ownership and supported mobile scope.
2. Specify the minimal versioned mobile authentication/bootstrap contract.
3. Add a focused sync contract with integration tests, including idempotency/conflict behavior.
4. Only then introduce the Android client in the chosen repository.
5. Add offline queue/recovery behavior incrementally with deterministic tests.

## Questions for the maintainer

- Should a native Android client live in this monorepo, a separate upstream repository, or remain community-owned?
- Is a native/offline client within GymCoach's intended product scope?
- If the client is separate, is upstream willing to own a stable/versioned mobile API contract?
- What compatibility window should mobile API versions have?
- What conflict policy is preferred when both server and offline client changed the same workout/set?
- Should background sync be supported explicitly, and are there token-scope/security constraints for it?
- Which parts of workout creation/editing should be available offline in the first supported slice?

## Out of scope for the first contribution

- Importing the existing 5k+ line prototype wholesale.
- Shipping APK binaries in an upstream PR.
- Production deployment or mobile release automation.
- Local operational/runbook files.
- Unrelated training-methodology changes.

## Local evidence

The exploratory implementation is represented primarily by local commits `be8ff07` (`feat: add native offline Android app`) and `422081e` (`fix: harden mobile sync recovery`). They are reference material for a future decomposition, not candidate commits to cherry-pick directly.
