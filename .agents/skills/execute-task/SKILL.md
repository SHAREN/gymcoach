---
name: execute-task
description: Implement exactly one prepared GymCoach Beads task in an isolated Codex Worktree and task branch. Use only when the user invokes execute-task with a TASK-ID and wants that READY task implemented, tested, documented, and moved to REVIEW without being closed.
---

# Execute Task

Implement one READY task and stop at REVIEW. Do not close the task and do not
start another task.

## Preflight

Before editing:

1. Read:

```text
AGENTS.md
CLAUDE.md
docs/PRODUCT.md
docs/ARCHITECTURE.md
docs/CURRENT_MILESTONE.md
docs/CODEX_WORKFLOW.md
```

2. Run bd prime, then inspect the task:

```text
bd show TASK-ID --long
```

If the task lookup fails, stop immediately without any Beads or Git mutation.
Only after the task exists, inspect its dependencies:

```text
bd dep list TASK-ID
```

3. Require all of the following:
   - the task exists;
   - status is open;
   - stage:ready is present;
   - acceptance criteria are non-empty;
   - blocking dependencies are complete;
   - the requested work is consistent with repository safety rules.
4. Confirm Git isolation:
   - current branch is not main or master;
   - git status is understood and contains no unrelated changes;
   - git rev-parse --git-dir differs from git rev-parse --git-common-dir after
     path normalization, proving this is a linked worktree;
   - the current Codex task is dedicated to this Beads task.
5. Inspect other active work:

```text
bd list --status in_progress,blocked --json
```

Require this task to have no uncertain overlap with another active task's
files, APIs, schemas, mobile contracts, training formulas, or deployment
surface. If ordering is required, stop and return the task to triage so the
dependency can be recorded. 6. Ensure the branch contains the Beads ID. If the worktree is clean and its
current branch does not contain the ID, create the correct focused branch:

```text
feat/TASK-ID-short-description
fix/TASK-ID-short-description
chore/TASK-ID-short-description
```

Use fix for bugs, feat for features, and chore for chores or research support.

Stop and report any failed precondition instead of guessing. Do not claim,
relabel, append notes, create or switch branches, edit files, or run gates until
every precondition passes.

The skill-specific rule to stop at REVIEW and never close the task overrides
any generic session-close suggestion printed by bd prime.

## Start Work

Claim the task atomically and remove READY:

```text
bd update TASK-ID --claim --remove-label stage:ready
```

If claim reports another assignee, stop.

## Implementation Rules

- Work only within the acceptance criteria.
- Keep one focused diff.
- Do not perform unrelated refactoring.
- Add or update tests for behavior changes.
- Validate API inputs with Zod.
- Preserve user scoping and security boundaries.
- Reuse existing UI primitives.
- Follow the NotebookLM workflow before any training-methodology decision.
- Update docs/ai-coach-principles.md when a training formula, threshold, prompt
  rule, or safety boundary changes.
- Do not begin a second task.
- Keep one write-owning agent for this task and Worktree. Parallel delegation
  is limited to read-only research, review, or verification.

For an unrelated discovery, invoke capture-issue and link the new task:

```text
bd dep add NEW-ID TASK-ID --type discovered-from
```

Do not fix the unrelated issue in the current diff.

If a genuine blocker appears, append the blocker evidence, set status blocked,
and stop. Do not broaden scope to work around an owner decision or external
dependency.

## Verification Before Review

Run the checks required by the changed area.

Web/backend/shared default:

```text
bash scripts/verify.sh
```

On the current Home PC, invoke the same script from PowerShell through Git
Bash:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh
```

Use the full gate when integration or E2E coverage is required. Its test
database prerequisites are mandatory. If they cannot be provided, do not move
the task to REVIEW; record the blocker and leave the task open:

```text
bash scripts/verify.sh --full
```

On the current Home PC, the full command is:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh --full
```

Android changes:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Shared mobile contracts or mirrored deterministic calculations require both
web and Android checks. Record every command and exit result. An unavailable
required check blocks the REVIEW transition; it is not successful evidence.

## Handoff To Review

Append a concise implementation note containing:

- summary of the focused change;
- files or modules changed;
- tests added or updated;
- commands run and results;
- non-blocking observations.

Then move the task to REVIEW:

```text
bd update TASK-ID --append-notes "Implementation evidence..." --add-label stage:review --status in_progress
```

Report the branch, diff summary, checks, and task state. End by stating that the
task is in REVIEW and has not been closed.
