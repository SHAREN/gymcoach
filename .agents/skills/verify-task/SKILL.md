---
name: verify-task
description: Independently verify one implemented GymCoach Beads task against its acceptance criteria, focused Git diff, tests, repository gates, cross-platform contracts, deployment requirements, and secret-safety rules. Use when the user invokes verify-task with a TASK-ID after implementation reached REVIEW.
---

# Verify Task

Perform an independent verification pass. Do not fix product code, rewrite
tests, expand scope, or implement follow-up work.

## Preflight

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

3. Require:
   - the task exists;
   - status is in_progress;
   - stage:review is present;
   - acceptance criteria are non-empty;
   - the current worktree and branch belong to this task.

If any precondition fails, stop without changing labels, notes, status, code,
tests, or branches. The Failure section below applies only after preflight has
succeeded and verification has begun.

The skill-specific verification lifecycle overrides any generic close
suggestion printed by bd prime.

Move the task into VERIFY before running checks:

```text
bd update TASK-ID --remove-label stage:review --add-label stage:verify
```

## Review

1. Determine the intended base branch from repository configuration, normally
   main through origin/HEAD.
2. Inspect git status, commits, and the complete diff against the merge base.
3. Map every changed file to an acceptance criterion.
4. Reject unrelated refactoring, generated local artifacts, or unexplained
   scope.
5. Confirm behavior changes have appropriate tests.
6. Check for secrets and local-only files without printing any suspected secret
   value. Reject:
   - .env or private environment files;
   - tokens, passwords, private keys, or credentials;
   - personal data;
   - machine-local settings or temporary artifacts.
7. Validate every acceptance criterion with code inspection, tests, or an
   explicit reproducible check.

## Required Commands

Run the canonical default gate:

```text
bash scripts/verify.sh
```

On the current Home PC, invoke the same script from PowerShell through Git
Bash:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh
```

This covers Prisma generation, lint, typecheck, unit/component tests, and the
production build.

Run the full gate when the changed area requires integration or E2E coverage.
Its test database prerequisites are mandatory. If they are unavailable, record
a verification failure and do not close the task:

```text
bash scripts/verify.sh --full
```

On the current Home PC, the full command is:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh --full
```

For Android code, resources, Gradle, or version metadata:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Also verify the published APK version, size, SHA-256, and latest.json when the
Android publishing gate applies.

Run both web and Android checks for shared mobile contracts, identifiers,
units, synchronization semantics, equipment constraints, or mirrored
deterministic calculations.

For training-methodology changes, verify NotebookLM evidence and the matching
docs/ai-coach-principles.md update. For completed product changes, require
evidence for any applicable canonical port 3030 deployment and public HTTPS
health check before closing.

## Success

Append verification evidence with:

- base branch and reviewed commit or diff;
- acceptance-criterion results;
- commands and exit results;
- scope review;
- test review;
- secret and local-file review;
- Android, training-science, or deployment evidence when applicable.

Then:

```text
bd update TASK-ID --append-notes "Verification evidence..." --remove-label stage:verify
bd close TASK-ID --reason "Acceptance criteria and required verification passed"
```

Report the task ID, branch, checks, and concise result.

## Failure

Do not modify code or tests. Append an exact finding list that includes file
locations, failed acceptance criteria, and failed commands. Then return the task
to implementation:

```text
bd update TASK-ID --append-notes "Verification failed: ..." --remove-label stage:verify --status in_progress
```

Report that the task remains open and requires implementation changes.
