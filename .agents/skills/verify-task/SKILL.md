---
name: verify-task
description: Independently verify one implemented GymCoach Beads task, record immutable evidence, and move product work to verified awaiting integration without closing it. Use with a TASK-ID after implementation reaches REVIEW, either explicitly or through the Project Dispatcher.
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
suggestion printed by bd prime. Product work never closes from isolated
verification.

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
docs/ai-coach-principles.md update. An isolated Android APK, temporary runtime,
or task-branch artifact is verification evidence only; it is never final
integration or closure evidence.

## Success

Append verification evidence with:

- exact full verified base and verified commit;
- acceptance-criterion results;
- commands and exit results;
- scope review;
- test review;
- secret and local-file review;
- artifact impact: Android, web/runtime, or no-runtime-artifact;
- installation/deployment requirements from the acceptance criteria;
- Android or training-science evidence when applicable.

The working tree must be clean and the verified commit immutable before the
transition.

### Product Or Runtime-Affecting Work

Remove VERIFY and move the task to VERIFIED / AWAITING_INTEGRATION:

```text
bd update TASK-ID --append-notes "Immutable verification evidence: verified-base FULL-SHA; verified-commit FULL-SHA; gates..." --remove-label stage:verify --add-label stage:verified --status in_progress
```

Create a unique temporary sanitized evidence JSON containing only the verified
base, verified commit, gate summary, and artifact impact. Mirror it without raw
logs or private data:

```text
node scripts/sync-beads-github.mjs --task TASK-ID --evidence-file PATH
```

Delete only that exact temporary file. A GitHub partial failure does not roll
back Beads or create a duplicate issue. Report the task as verified and awaiting
integration. Do not call bd close.

Do not remove the verifier or implementation Worktree from the active verifier
thread. After this thread becomes inactive, the Project Dispatcher may plan
cleanup of the clean verifier Worktree. The implementation Worktree becomes a
cleanup candidate only at `stage:verified` or closed and remains protected if
any thread still uses it, it is dirty, owner-preserved, or it is the current
source/integration Worktree.

### Explicit No-Runtime-Artifact Exception

Use this only when the acceptance criteria and independent scope review prove
that the complete diff is pure harness/docs/infrastructure with no downstream
runtime artifact. Create a no-runtime-artifact manifest whose changedPaths
exactly match the verified Git diff, then validate and close through the same
deterministic wrapper:

```text
node scripts/check-integration-evidence.mjs --manifest PATH
node scripts/close-integrated-tasks.mjs --manifest PATH --dry-run
node scripts/close-integrated-tasks.mjs --manifest PATH
```

The wrapper requires stage:verify, closes Beads only after the exception guard
passes, and then closes the exact GitHub mirror. Do not use the exception for
app, Android, Watch, backend, shared contract, package/runtime, deployment, or
artifact-publishing changes. Dockerfile, Docker Compose, runtime build,
deployment, CI publication, and artifact-publication paths are runtime-affecting
for this guard and must be rejected. Treat release/build/runtime/service scripts,
deployment/operations directories, and all checked-in GitHub workflow/action
automation conservatively as runtime-affecting.

## Failure

Do not modify code or tests. Append an exact finding list that includes file
locations, failed acceptance criteria, and failed commands. Then return the task
to implementation:

```text
bd update TASK-ID --append-notes "Verification failed: ..." --remove-label stage:verify --status in_progress
```

Mirror the returned lifecycle state with
node scripts/sync-beads-github.mjs --task TASK-ID. GitHub failure remains a
separate partial failure and never changes the Beads verification result.

Verification failure makes only the inactive verifier Worktree potentially
obsolete. Preserve the implementation Worktree for the sole writer's
correction. Cleanup is performed later by the Dispatcher through a dry-run and
explicit `--apply` of `scripts/cleanup-obsolete-worktree.mjs`; the guard must
use fresh complete real Codex thread state and must not force Windows locks.

Report that the task remains open and requires implementation changes.
