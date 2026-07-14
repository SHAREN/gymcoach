# Current Milestone

Last updated: 2026-07-15

## Development Goal

Open question: the repository does not contain an owner-confirmed milestone
record.

Assumption based on the active branch name, committed Android architecture
document, and current worktree evidence: the current development focus is the
native offline Android application and practical parity with the web workout
flow.

This assumption must not be used to start work automatically. The owner should
confirm or replace it, then update this document and prepare matching Beads
tasks through triage.

## Expected Result

Assumption:

- A native Android application can authenticate, bootstrap data, start or
  resume a workout offline, record and edit sets, finish the session, calculate
  supported next-set guidance locally, and synchronize without silent data
  loss.
- The online Android experience remains compatible with the current web and
  backend contracts.
- The published APK metadata points to the current verified build.

## Candidate In Scope

Assumption:

- Android offline workout persistence and recovery.
- Ordered, idempotent mobile synchronization.
- Mobile API and Kotlin model compatibility.
- Deterministic calculation parity required for the offline workout flow.
- Core web/Android workout interaction parity.
- Android build, lint, unit tests, APK publication, and download metadata.

## Not Confirmed In Scope

- New training methodology or new numerical coaching thresholds.
- Medical or rehabilitation guidance.
- A new project-management UI or background orchestration service.
- Broad refactoring unrelated to Android parity.
- Social, leaderboard, or hosted subscription features.

Open question: the owner must confirm the actual exclusions for this milestone.

## Main Risks

- Silent data loss or mutation reordering during offline synchronization.
- Web, backend, and Android contract drift.
- Divergent TypeScript and Kotlin training calculations.
- A stale or incorrectly hashed APK remaining published.
- Concurrent work in multiple worktrees being overwritten during integration.
- Training changes bypassing NotebookLM research and the normative principles
  document.
- A verified change remaining only on a temporary runtime instead of canonical
  port 3030.

## Milestone Maintenance

- Beads is the source of truth for milestone tasks.
- docs/CURRENT_MILESTONE.md describes direction, not a task list.
- Only tasks with stage:ready and explicit milestone alignment may be selected
  by the next-task workflow.
- Update this file when the owner changes the milestone goal, scope, expected
  result, or risks.
