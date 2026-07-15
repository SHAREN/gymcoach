# Codex Development Workflow

Beads is the single source of truth for GymCoach project tasks. Codex tasks,
Git branches, and Git worktrees are execution environments, not backlog
records.

The generated beads skill provides generic CLI orientation only. For GymCoach,
the five workflow skills and AGENTS.md are authoritative for all task
mutations.

## Daily Process

1. New ideas and bugs are captured into INBOX.
2. INBOX tasks are reviewed and prepared.
3. Only READY tasks may be implemented.
4. Each implementation uses a separate Codex task and Worktree.
5. One task equals one branch and one focused diff.
6. New discoveries become separate related tasks.
7. Every task must pass independent verification before closing.

## Workflow States

Use Beads standard statuses plus at most one workflow stage label:

| Workflow state | Beads status | Stage label                                            |
| -------------- | ------------ | ------------------------------------------------------ |
| INBOX          | open         | stage:inbox                                            |
| READY          | open         | stage:ready                                            |
| IN_PROGRESS    | in_progress  | none                                                   |
| REVIEW         | in_progress  | stage:review                                           |
| VERIFY         | in_progress  | stage:verify                                           |
| DONE           | closed       | none                                                   |
| BLOCKED        | blocked      | preserve the prior stage only when it helps resumption |

The normal path is:

```text
INBOX -> READY -> IN_PROGRESS -> REVIEW -> VERIFY -> DONE
                         \-> BLOCKED
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
   task of the current root user request;
6. dispatches execute-task for each task;
7. runs independent tasks concurrently and ordered tasks serially;
8. dispatches a separate verify-task pass;
9. integrates verified commits in dependency order into a local integration
   branch and Worktree;
10. reruns the applicable gates against the combined result.

The coordinator asks the user only when a material decision or new authority
is required. Questions, explanations, read-only reviews, and diagnostics do not
enter the implementation lifecycle automatically.

For work that continues beyond the current turn, the Codex app coordinator
creates or reuses one thread heartbeat as a recovery watchdog. Each heartbeat
re-reads Beads and live thread state, never trusts hardcoded task state, and
must not create duplicate writers or verifiers. It is paused or disabled when
the root request completes or needs user authority.

Not-started dependency-ordered work stays `open + stage:ready`; the dependency
graph keeps it out of `bd ready` until prerequisites close. Native `blocked`
is reserved for external/manual blockers or paused work. Before resuming a
legacy `blocked + stage:ready` task, the coordinator validates all dependencies
and the final integration base, changes it to `open`, and confirms readiness.

Automation does not include push, pull-request creation or merge, merging into
main or master, remote Beads synchronization, production deployment, or service
restart unless the user explicitly requests those actions.

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

When execution begins, claim the Beads task and remove stage:ready. During
implementation:

- change only what the acceptance criteria require;
- keep one focused diff;
- add or update tests;
- do not perform unrelated refactoring;
- do not begin a second task;
- capture unrelated discoveries as separate Beads tasks;
- link discovered work with discovered-from or relates-to as appropriate.

After implementation, run the applicable checks, append concise evidence, and
move the task to stage:review. The implementing task does not close itself.

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
docs/ai-coach-principles.md rules. Product work is not DONE until any applicable
APK publishing and canonical deployment gates in AGENTS.md have evidence.

On success, append verification evidence, remove stage:verify, and close the
task with a reason. On failure:

- do not fix the code automatically;
- leave the task in in_progress;
- remove stage:verify;
- append exact findings and failed commands;
- return the task to the implementer.

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

GitHub issues and pull requests may still be linked from Beads as external
references, but Beads remains authoritative for task status and dependencies.

## Manual Boundaries

- Capture alone does not create a Codex task. A clear implementation request
  creates one automatically only after the Beads task reaches READY.
- If the current Codex surface cannot create tasks or Worktrees, the user must
  perform the exact creation action reported by the coordinator.
- New or changed Codex hooks require project trust and may require review
  through /hooks plus a Codex restart.
- Beads remote synchronization is explicit. This setup does not push
  refs/dolt/data automatically.
- The owner must confirm the current milestone before milestone alignment can
  be a strict selection gate.
- Production deployment remains subject to the authority and rollback rules in
  AGENTS.md.
