---
name: next-task
description: Select and explain the next eligible GymCoach Beads task without claiming or implementing it. Use when the user asks what to work on next, requests the next READY task, wants queue prioritization, or needs a dependency-aware recommendation from fresh Beads and stateless Dispatcher state.
---

# Next Task

Select one task. Do not claim it, change its status, create a branch, create a
Codex task, or begin implementation.

## Load Candidates

Read:

```text
AGENTS.md
docs/CODEX_WORKFLOW.md
```

When invoked by the Dispatcher, read the fresh output from
`scripts/harness-status.ps1` first. `readyTasks` are implementation candidates;
`awaitingIntegrationTasks` must be routed to integration instead of selected as
new implementation work.

Then query blocker-free READY work:

```text
bd ready --label stage:ready --sort priority --json
```

Also inspect active work before recommending parallel execution:

```text
bd list --status in_progress,blocked --json
```

bd ready already excludes in_progress, blocked, deferred, closed, and tasks with
active blockers.

## Selection Order

Apply these rules in order:

1. The task has stage:ready.
2. All blocking dependencies are complete.
3. Native priority and label agree, ordered P0, P1, P2, then P3.
4. For equal candidates, choose the oldest created task.
5. When another task is active, the candidate has no overlapping files, APIs,
   schemas, shared mobile contracts, training formulas, or deployment surface.

Do not select P4 or a task with inconsistent stage, type, or priority metadata.
Report it as needing triage.

When the user is continuing an existing root request, prefer tasks linked by
current Beads dependencies or root-request notes. Do not use a static milestone
document as queue authority and do not infer request membership from a title.

Do not recommend concurrent execution when task scope is missing or overlap is
uncertain. Report that the candidate needs triage or must wait for the active
task. Do not add dependencies automatically during read-only selection.

Inspect the selected task:

```text
bd show TASK-ID --long
```

If acceptance criteria are missing, reject the candidate and report that it
must return to triage.

## Response

Show:

```text
ID: TASK-ID
Title: Short title
Priority: P1
Modules: web, backend
Dependencies: none
Parallel safety: no overlap with active work
Acceptance criteria:
- ...
Reason selected: highest-priority blocker-free READY task; oldest among equal candidates and safe against active work.
```

End with:

```text
The task was not claimed or started.
```
