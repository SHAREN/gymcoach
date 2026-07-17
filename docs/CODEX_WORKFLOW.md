# Codex Development Workflow

Beads is the single source of truth for GymCoach project tasks. Codex tasks,
Git branches, and Git worktrees are execution environments, not backlog
records.

The generated beads skill provides generic CLI orientation only. For GymCoach,
the six workflow skills and AGENTS.md are authoritative for all task
mutations.

## Daily Process

1. New ideas and bugs are captured into INBOX.
2. INBOX tasks are reviewed and prepared.
3. Only READY tasks may be implemented.
4. Each implementation uses a separate Codex task and Worktree.
5. One task equals one branch and one focused diff.
6. New discoveries become separate related tasks.
7. Product verification moves work to awaiting integration, not DONE.
8. Guarded integration is the only normal product close path.
9. GitHub Issues mirror Beads state; they never become the task source of truth.
10. The Dispatcher removes obsolete inactive task Worktrees through the
    deterministic cleanup guard after their lifecycle use ends.

## Workflow States

Use Beads standard statuses plus at most one workflow stage label:

| Workflow state                  | Beads status | Stage label                                            |
| ------------------------------- | ------------ | ------------------------------------------------------ |
| INBOX                           | open         | stage:inbox                                            |
| READY                           | open         | stage:ready                                            |
| IN_PROGRESS                     | in_progress  | none                                                   |
| REVIEW                          | in_progress  | stage:review                                           |
| VERIFY                          | in_progress  | stage:verify                                           |
| VERIFIED / AWAITING_INTEGRATION | in_progress  | stage:verified                                         |
| DONE                            | closed       | none                                                   |
| BLOCKED                         | blocked      | preserve the prior stage only when it helps resumption |

The normal path is:

```text
INBOX -> READY -> IN_PROGRESS -> REVIEW -> VERIFY
                         \-> BLOCKED          |
                                              v
                              VERIFIED / AWAITING_INTEGRATION
                                              |
                                              v
                                   GUARDED INTEGRATION -> DONE
```

Stage labels are mutually exclusive. Beads native status is authoritative for
open, in-progress, blocked, and closed behavior.

## Label Vocabulary

Stage:

```text
stage:inbox
stage:ready
stage:review
stage:verify
stage:verified
```

Type:

```text
type:bug
type:feature
type:chore
type:research
```

Area:

```text
area:web
area:android
area:backend
area:shared
area:infrastructure
```

Priority:

```text
priority:P0
priority:P1
priority:P2
priority:P3
```

Keep the required type and priority labels synchronized with Beads native type
and priority fields. Use native type task plus type:research for research work,
because research is not a built-in Beads type.

Priority meanings:

- P0: data loss, a critical vulnerability, or complete loss of a core function.
- P1: an important function is broken, but the application remains partly
  usable.
- P2: an ordinary bug or meaningful improvement.
- P3: a cosmetic issue, idea, or technical debt.

## Project Dispatcher

Keep one long-lived Codex task named:

```text
Project Dispatcher
```

Use it as the default code-read-only coordinator:

```text
$capture-issue
$triage-inbox
$next-task
```

Capturing a Beads task must not create a visible Codex task, switch branches,
claim work, or interrupt an active implementation. After successful triage,
an explicit implementation request may automatically create and dispatch a
separate Codex Worktree task.

## Automatic Request Routing

For a concrete implementation request, the user may describe the desired
change in ordinary language. Explicit skill commands are optional. The
coordinator automatically:

1. captures the request in Beads;
2. triages it to READY when the requirements are sufficiently clear;
3. decomposes independent deliverables into linked tasks;
4. records dependencies for overlapping or ordered work;
5. creates a dedicated Codex task, Worktree, and branch for each READY child
   task of the current root request and records its exact implementation
   thread/host/resolved-path binding in Beads;
6. dispatches execute-task for each task;
7. runs independent tasks concurrently and ordered tasks serially;
8. records the verifier Worktree binding and dispatches a separate verify-task
   pass, which leaves product work at stage:verified;
9. dispatches integrate-tasks to combine verified commits in dependency order
   in a local integration branch and Worktree, recording its binding on the root
   task;
10. reruns the applicable gates, validates final artifacts, and closes tasks
    only through the deterministic guard;
11. after implementation, verifier, and integration threads become inactive
    and their Worktrees are no longer needed, plans and applies repository-
    guarded Worktree cleanup without touching preserved or active work.

The coordinator asks the user only when a material decision or new authority
is required. Questions, explanations, read-only reviews, and diagnostics do not
enter the implementation lifecycle automatically.

For work that continues beyond the current turn, the Codex coordinator creates
or reuses one thread heartbeat. It rereads Beads and live task state on every
run, avoids duplicate writers/verifiers, performs eligible Worktree cleanup
from a fresh complete live thread snapshot, and stops when the root request is
complete or needs new authority.

Not-started dependency-ordered work remains `open + stage:ready`; the dependency
graph keeps it out of bd ready. Native blocked is reserved for external/manual
blockers or paused work. Before resuming a legacy `blocked + stage:ready` task,
revalidate dependencies and the integration base, return it to open, and
confirm readiness.

The owner has authorized only post-integration GitHub publication: a verified
dedicated codex/ or task branch may be pushed to SHAREN/gymcoach and exposed as
a draft PR against main. Automation never pushes an unverified writer branch,
auto-merges, merges main/master, synchronizes Beads remotely, deploys production,
or restarts services.

## Built-In Codex Integration

The repository integrates the workflow directly with Codex:

- Codex discovers the checked-in workflow skills from .agents/skills.
- .codex/config.toml enables stable hooks and multi-agent support for this
  trusted project.
- .codex/hooks.json loads and refreshes Beads context on session start, prompt
  submission, and context compaction.
- The long-lived Project Dispatcher task remains available while separate
  implementation tasks run in Codex-managed Worktrees.

Project-local configuration and hooks load only for a trusted checkout. Review
them with /hooks after changes. A new Codex task or application restart may be
required after changing skill or hook files.

## Automatic Worktree Cleanup

The preserved Project Dispatcher owns cleanup after an implementation,
verifier, or integration thread is no longer running and the Worktree is no
longer needed. A child task records cleanup eligibility at handoff but never
self-removes. Hooks do not run cleanup because they do not have an authoritative
complete view of live Codex thread state.

For every explicit candidate, the Dispatcher preserves the raw unfiltered
`codex_app.list_threads` envelope requested with exactly `limit: 50` and
`query: null`, then creates a temporary local manifest based on
`scripts/fixtures/worktree-cleanup/registered-worktree.json`. The manifest
records the exact candidate, owning thread, managed root, current source,
current integration Worktrees, owner-preserved paths, expected branch, and full
HEAD. It is planning input, not durable project state, and must not contain
private logs or secrets. `wait_threads`, a filtered query, a response containing
50 threads, flattened caller-declared thread fields, unavailable hosts, or a
missing active cleanup-executor thread is incomplete evidence and fails closed.
The binding marker is appended by the Dispatcher only from the real thread
creation/listing result and the resolved Worktree path; implementation,
verification, and integration agents must not invent a missing thread or host
identity at cleanup time.

Always plan before mutation:

```text
node scripts/cleanup-obsolete-worktree.mjs --manifest PATH
node scripts/cleanup-obsolete-worktree.mjs --manifest PATH --apply
```

The guard fails closed unless all of the following hold:

- the raw thread snapshot is fresh, unfiltered, below the tool limit, has no
  unavailable hosts, and is supplied by `codex_app.list_threads` with its
  request and response provenance intact;
- the owning thread exists at the exact resolved candidate path and every
  thread mapped to that path is inactive;
- Beads notes contain one exact machine-readable `Codex worktree binding v1`
  marker in the form `Codex worktree binding v1: task=TASK-ID; role=ROLE;
thread=THREAD-ID; host=HOST-ID; path-sha256=SHA256`, binding the task, derived
  role, thread, host, and resolved path SHA-256; a caller-declared role cannot
  override or replace this ownership evidence;
- Beads status and its single stage label are compatible with the candidate
  role: implementation is closed or `stage:verified`, verifier has completed
  its success/failure lifecycle, and integration is closed;
- the Worktree is registered under the same Git common directory, is unlocked,
  is not main/master or the primary/current Worktree, and has no staged,
  unstaged, conflicted, or untracked changes;
- the live branch and immutable HEAD match the dispatcher-recorded values;
- the path is not the dispatcher, current source, current integration,
  owner-preserved, current execution, or a `worktree:preserve` path.

If the immutable HEAD has no durable head, remote, tag, or existing archive ref,
create and verify
`refs/codex/worktree-archive/TASK-ID/FULL-SHA` before removal. Never delete the
branch. Remove an eligible registered Worktree only with non-forced
`git worktree remove`, then verify de-registration, path absence, and measured
reclaimed bytes.

If Git removed the registration but Windows left a locked residual directory,
stop and report it. The registered pass first stores an immutable canonical
receipt blob at
`refs/codex/worktree-cleanup-receipts/TASK-ID/RECEIPT-SHA256`. A later
residual-mode pass accepts only that Git ref, not inline receipt JSON, and
revalidates the receipt schema and age; task/role/thread/host/path, common Git
directory, branch, immutable HEAD and original removal intent; and current
archive or durable-ref reachability. Only then may it remove that exact
unregistered path after proving its real path is a strict descendant of the
allowed managed root. Never use
`--force`, permission changes, retry loops, junction-following, or a recursive
fallback after Git failure. Missing, stale, ambiguous, dirty, active, or locked
evidence always preserves the Worktree.

## Safe Parallel Task Execution

The queue may have multiple active implementations, but parallel execution is
allowed only when all of these conditions hold:

1. Every implementation has its own Beads task, Codex task, branch, and
   Worktree.
2. Every task was independently triaged to stage:ready before it was claimed.
3. The tasks have no unresolved dependency or required ordering.
4. Their affected files, APIs, database schema, mobile contracts, training
   formulas, and deployment surfaces do not overlap.
5. Each task has one write-owning implementation agent. Parallel subagents in
   the same task are limited to read-only research, review, or verification.

Before selecting another task while work is active, inspect:

```text
bd list --status in_progress,blocked --json
bd dep list CANDIDATE-ID
```

If ownership or ordering is uncertain, do not start the candidate. Add or
request the appropriate Beads dependency during triage and run the tasks
serially. If an overlap is discovered after work begins, stop the newer task,
record the conflict, and set it to blocked until the earlier task is integrated.

The Dispatcher may continue capturing and triaging unrelated work during all
active implementations. Queue operations never interrupt those tasks.

## Capture

Invoke:

```text
$capture-issue

Add this to the queue without interrupting the current task:
...
```

The skill checks likely duplicates, preserves the original report, assigns
preliminary type, area, and priority, and creates an open task with
stage:inbox.

A probable but uncertain duplicate remains a separate task linked with a
relates-to relationship. Only an obvious confirmed duplicate may be handled as
a duplicate.

Capture never edits product code.

After the authoritative Beads create/comment succeeds, run the idempotent
GitHub mirror for the exact task ID. GitHub failure is a partial failure: keep
the Beads task, report the failure, and retry without creating another issue.

## Triage

Invoke:

```text
$triage-inbox
```

Triage clarifies selected INBOX tasks, records current and expected behavior,
adds reproduction steps for bugs, defines acceptance criteria, lists affected
modules, records dependencies and risks, and synchronizes labels.

Move a task to stage:ready only when:

- the expected outcome is clear;
- acceptance criteria are testable;
- affected areas are identified;
- dependencies are represented in Beads;
- priority and risk are reasonable;
- required product or training-science decisions are resolved.

Triage never edits code and never starts implementation.

Mirror each successful lifecycle transition to the existing GitHub issue. The
mirror persists its URL in external_ref and synchronizes only sanitized state,
classification, acceptance criteria, and structured evidence.

## Select the Next Task

Invoke:

```text
$next-task
```

Selection order:

1. The task has stage:ready.
2. All blocking dependencies are complete.
3. Priority is P0, P1, P2, then P3.
4. The task aligns with docs/CURRENT_MILESTONE.md.
5. For a tie, select the oldest task.

When another implementation is active, also reject a candidate whose affected
files or shared contracts overlap that active work. Missing scope information
is a triage defect, not permission to run the tasks concurrently.

If the current milestone remains an open question, report that the milestone
criterion could not be applied and use the remaining ordering. Selection does
not claim or start the task.

## Start Implementation

The coordinator normally creates the implementation task automatically after
triage. It chooses the GymCoach project, creates a Worktree from the recorded
integration base, and names the task:

```text
TASK-ID - Short task title
```

It then sends:

```text
$execute-task TASK-ID
```

The execute skill must stop before editing when the task is missing, is not
READY, lacks acceptance criteria, has open blockers, is running on main or
master, or is not inside a separate Git worktree.

Branch names include the Beads ID:

```text
feat/TASK-ID-short-description
fix/TASK-ID-short-description
chore/TASK-ID-short-description
```

When execution begins, claim the Beads task, remove stage:ready, and update its
single GitHub mirror. During
implementation:

- change only what the acceptance criteria require;
- keep one focused diff;
- add or update tests;
- do not perform unrelated refactoring;
- do not begin a second task;
- capture unrelated discoveries as separate Beads tasks;
- link discovered work with discovered-from or relates-to as appropriate.

After implementation, run the applicable checks, append concise evidence, and
move the task to stage:review. Mirror the new state. The implementing task does
not close itself and does not remove its current Worktree. REVIEW and VERIFY
Worktrees remain protected. The Dispatcher considers the implementation
Worktree for cleanup only after a later verified/closed state and inactive
thread snapshot prove it is no longer needed.

## Verification

In the implementation Codex task, invoke:

```text
$verify-task TASK-ID
```

Verification is a separate pass. The verifier moves stage:review to
stage:verify, checks every acceptance criterion, reviews the complete diff
against the base branch, checks scope and tests, runs the applicable repository
gates, and scans the diff for secrets or local-only files.

Default web/backend/shared gate:

```text
bash scripts/verify.sh
```

On the current Home PC, run the same canonical script from PowerShell through
Git Bash:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh
```

Full gate when integration or E2E coverage is required. Its database and
browser prerequisites are mandatory; if they are unavailable, verification
fails and the task must remain open:

```text
bash scripts/verify.sh --full
```

The corresponding Home PC full-gate command is:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh --full
```

Android gate after Android code, resources, Gradle configuration, or version
metadata changes:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Shared mobile contracts and mirrored deterministic logic require both web and
Android checks. Training-methodology work also requires the NotebookLM and
docs/ai-coach-principles.md rules.

On product success, record the exact verified base, exact verified commit, gate
commands/results, scope, artifact impact, and any installation/deployment
requirements. Remove stage:verify and add stage:verified. The task remains
in_progress and the GitHub issue remains open as verified / awaiting integration.
An isolated task APK or temporary runtime is not closure evidence.

A pure harness/docs/infrastructure task may close from isolated verification
only through an explicit no-runtime-artifact manifest. The deterministic guard
must prove that its declared changed paths exactly match the verified Git diff
and contain no product/runtime paths. This is the sole exception to integration.

On failure:

- do not fix the code automatically;
- leave the task in in_progress;
- remove stage:verify;
- append exact findings and failed commands;
- return the task to the implementer.

Every verification transition updates the exact GitHub mirror with sanitized
structured evidence only. A mirror failure does not change the Beads result.

After the verifier thread becomes inactive, the Dispatcher may clean its clean
verifier Worktree whether verification returned an exact failure to the writer
or moved the task to `stage:verified`. Verification failure never makes the
implementation Worktree obsolete. A successful implementation Worktree is
eligible only after `stage:verified` or guarded closure and the same live-thread
and Git safety checks pass.

## Guarded Integration And Closure

Invoke:

```text
$integrate-tasks ROOT-TASK-ID
```

Use one dedicated integration Worktree and preferably a branch named
codex/integration-ROOT-TASK-ID. Read every stage:verified task, order commits by
dependencies, record `authority.rootTaskId`, record the complete
requiredTaskIds set, and preserve newer work. The guard rereads that Beads root
and every transitive `blocks` dependency, then requires the reviewed manifest
set to match the authoritative verified task set exactly. Context-only
`relates-to` and `discovered-from` links do not become integration tasks. Each
verified commit must be either:

- an ancestor of the integration head; or
- represented by explicit reviewed behavior-equivalent replacement commits.

A cherry-pick changes commit identity and therefore uses a behavior-equivalent
mapping unless the original verified commit is also integrated by ancestry.

Run all combined gates. For Android work, build and publish a fresh APK from the
integration head. Verify versionName, versionCode, file size, SHA-256, signing
certificate, app-debug.apk, immutable hash-qualified APK, and latest.json.
Before closure, a separate integration reviewer records a passed review against
the exact integration head.

Represent delivery facts separately:

```text
integrated
published
installed
deployed
```

Optional unauthorized installation/deployment is not-authorized, not complete.
If acceptance criteria require either stage, it remains required and pending and
the guard rejects closure. These requirements are derived from the live Beads
acceptance criteria for the root and blocking dependency graph, not from
manifest-declared task booleans. Only direct delivery obligations count;
conditional or hypothetical criteria, state-separation language, prohibitions,
and unauthorized/optional statements do not require installation or deployment.

Use a local integration manifest based on the checked-in fixtures, then run:

```text
node scripts/check-integration-evidence.mjs --manifest PATH
node scripts/close-integrated-tasks.mjs --manifest PATH --dry-run
node scripts/close-integrated-tasks.mjs --manifest PATH
```

The closure wrapper validates again, requires stage:verified, closes Beads, and
only then closes the exact GitHub mirror with sanitized integration/artifact
evidence. Root coordination tasks are closed last, after all computed mapped
tasks and delivery gates pass. It reports GitHub partial failures without
rolling back Beads.

Before the first mutation, the wrapper plans every task in computed closure
order as `skip`, `close-only`, or `update-and-close`. If an update appended the
exact deterministic guarded note and removed all stages but the following
`bd close` failed, retry accepts only that exact stage-less task with its
allowed pre-close status and performs `close-only`; it never appends the note a
second time. Missing, duplicate, mismatched, or stage-bearing partial evidence
fails closed, so later dependency/root actions cannot hide an earlier partial
failure.

After a post-closure GitHub partial failure, retry only the mirror:

```text
node scripts/close-integrated-tasks.mjs --manifest PATH --mirror-only --dry-run
node scripts/close-integrated-tasks.mjs --manifest PATH --mirror-only
```

The mirror-only dry-run executes the real retry's read-only issue planning,
including exact Beads marker matching, external_ref validation/persistence
planning, deterministic duplicate detection, label planning, and issue reuse.
Per-task failures are isolated and reported together; a failure never prevents
the remaining task mirrors from being checked.

Legacy tasks closed before this state machine are not destructively rewritten.
Integration audits must list them. Missing legacy commits or mappings are
flagged and block the root request until resolved.

The integration Worktree remains protected while it is the current source or
current integration Worktree. Only after guarded closure, any authorized draft
publication, an explicit `noLongerNeeded` decision, and an inactive integration
thread may the Dispatcher plan and apply its cleanup. Publication, installation,
and deployment remain independent facts and do not authorize cleanup by
themselves.

## GitHub Issue Mirror

Beads is authoritative. GitHub Issues in SHAREN/gymcoach are an idempotent
mirror keyed by the exact Beads ID marker. Existing mirror issues #6 and #7 are
detected from their exact Beads task lines and must never be duplicated.

Single task update:

```text
node scripts/sync-beads-github.mjs --task TASK-ID --dry-run
node scripts/sync-beads-github.mjs --task TASK-ID
```

Backfill current open/in_progress/blocked tasks:

```text
node scripts/sync-beads-github.mjs --backfill --dry-run
node scripts/sync-beads-github.mjs --backfill
```

The mirror preserves unrelated GitHub labels while replacing managed status,
stage, type, priority, and area labels. It persists external_ref only after a
unique issue succeeds. Exact-ID duplicates are an error. Raw notes/logs,
credentials, private paths, device identifiers, browser state, and personal
data are never sent. Partial failures are reported per task and safe to retry.

## Draft PR Publication

Only after guarded integration and independent integration verification:

```text
node scripts/publish-integration-draft.mjs --manifest PATH --dry-run
node scripts/publish-integration-draft.mjs --manifest PATH
```

The command revalidates integration evidence, origin SHAREN/gymcoach, the
dedicated codex/ or task branch, and default base main. It pushes only that
verified branch and creates or updates a draft PR. It never auto-merges and does
not imply installation or deployment.

## Messages During Active Work

New unrelated idea:

```text
$capture-issue

Add this to the queue without interrupting the current task:
...
```

Correction to the active implementation:

```text
This concerns the active task. Adjust the current implementation:
...
```

Critical interruption:

```text
P0 INTERRUPT:
...
```

Even a P0 is first captured as a separate Beads task. It interrupts active work
only after the user explicitly confirms the P0 classification and interruption.

## Beads Commands

Useful read operations:

```text
bd prime
bd where
bd list --label stage:inbox --status open
bd ready --label stage:ready --json
bd show TASK-ID --long
bd status --no-activity
```

Task data lives in the embedded Dolt database shared by repository worktrees.
Cross-machine synchronization uses:

```text
bd dolt pull
bd dolt push
```

Do not treat .beads/issues.jsonl as the source of truth or as a backup.

## Legacy Task Sources

docs/loops and the existing .claude/skills describe an earlier GitHub
Issue-to-PR experiment. They are retained as historical and architectural
reference.

They must not:

- create or select new project work outside Beads;
- append new tasks to docs/loops/ideas-backlog.md;
- implement a GitHub issue that does not have a prepared READY Beads task;
- override this workflow's separate verification pass.

The historical GitHub issue loop remains inactive. The current GitHub Issues
integration is only the deterministic sanitized Beads mirror described above;
it cannot create or select work independently.

## Manual Boundaries

- Capture alone does not create a Codex task. A clear implementation request
  creates one automatically only after the Beads task reaches READY.
- If the current Codex surface cannot create tasks or Worktrees, the user must
  perform the exact creation action reported by the coordinator.
- New or changed Codex hooks require project trust and may require review
  through /hooks plus a Codex restart.
- Beads remote synchronization is explicit. This setup does not push
  refs/dolt/data automatically.
- GitHub publication is limited to a verified dedicated branch and draft PR.
  Automatic merge remains prohibited.
- Automatic Worktree cleanup is limited to explicit candidates that pass the
  repository guard. Windows locks or missing live-thread evidence require a
  report and preservation, not force deletion.
- The owner must confirm the current milestone before milestone alignment can
  be a strict selection gate.
- Production deployment remains subject to the authority and rollback rules in
  AGENTS.md.
