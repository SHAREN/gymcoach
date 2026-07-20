# Stateless Project Dispatcher v2

## Coordinator Prompt

Run `pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/harness-status.ps1`
first on every cycle. When a fresh raw `codex_app.list_threads` envelope is
available, pass it with `-ThreadSnapshotPath`; otherwise obey the emitted
fail-closed source health and do not create a writer or verifier.

If the unfiltered envelope reaches the 50-thread tool limit, collect a fresh
exact query for each relevant Beads task and pass each raw envelope with a
single `-TaskThreadSnapshotPath` array argument. Do not author task or role
fields in these files; the query, current Beads stage, durable bindings, and
safe thread fields are the evidence.

```powershell
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/harness-status.ps1 `
  -ThreadSnapshotPath $globalPath `
  -TaskThreadSnapshotPath @($taskPathA, $taskPathB)
```

Trust only the fresh JSON and current read-only Beads state. Treat every durable
writer/verifier reservation or Worktree binding as creation-pending or
unresolved until explicitly reconciled. Absence from local SQLite or saved
session indexes is never permission to retry `create_thread`.

Perform at most one safe transition from `proposedActions` per cycle. Never
duplicate a writer or verifier, edit product code, or change another task's
Worktree. Never deploy, restart, push, create a PR, merge main/master, publish an
APK, or change an automation target without direct user authorization.

Report only a task start, a task completion, a real blocker, or a required user
decision. Otherwise remain quiet and let the next cycle rebuild state.

## Thread Snapshot Boundary

PowerShell can read safe identity fields from Codex SQLite, but those files do
not prove Desktop runtime state and cannot expose queued `clientThreadId`
entries held in Electron memory. The fallback therefore sets
`codexThreads.complete=false` and suppresses writer/verifier creation.

A globally complete snapshot preserves a fresh raw unfiltered
`codex_app.list_threads` envelope with `limit: 50`, `query: null`, no unavailable
hosts, strict safe-field records, and fewer than 50 returned threads. When that
same structurally valid baseline returns exactly 50 threads, creation remains
globally suppressed but a specific task may be reconciled with a second raw
envelope whose request and response query both exactly equal the current Beads
task ID. The scoped envelope must use limit 50, be fresh and no older than the
global baseline, report no unavailable hosts, contain fewer than 50 strictly
valid records, and contain no duplicate or ambiguous active ownership. A
missing, stale, capped, mismatched, malformed, duplicate, or unavailable scope
does not authorize creation for that task. Every created writer/verifier task
must keep the exact Beads ID in searchable thread text so later reconciliation
uses the same deterministic query.

Store temporary snapshots outside the repository, include no raw messages, and
delete them through the caller's normal temporary-file lifecycle. The status
script only reads supplied files. Task-scoped reconciliation authorizes only a
writer/verifier decision for that exact task; it never satisfies the cleanup
guard's separate complete unfiltered snapshot requirement.

Durable Beads reservations remain authoritative even with a complete snapshot.
If a reserved client thread has not resolved, perform explicit timeout/recovery
inspection and ask for a user decision when needed. Do not retry automatically.

## Validation And Migration

1. Run `node scripts/test-harness-status.mjs` and confirm fixture-only tests.
2. Run the live PowerShell command and parse its stdout as JSON. Below the tool
   cap, confirm global completeness. At the 50-thread boundary, confirm that the
   unfiltered envelope alone suppresses creation and that an exact under-cap
   task query unlocks only its matching safe action.
3. Run changed-skill validation and `scripts/verify.sh`.
4. Obtain independent `verify-task` review of the complete focused diff.
5. Only after that verification may the owner switch the existing heartbeat
   prompt or `target_thread_id` to v2. This change does not edit the current
   heartbeat, its automation file, or its target.

See [project-dispatcher-v2-status.json](examples/project-dispatcher-v2-status.json)
for a sanitized schema example.
