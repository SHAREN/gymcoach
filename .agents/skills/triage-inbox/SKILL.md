---
name: triage-inbox
description: Prepare selected GymCoach Beads INBOX tasks for development without editing code or starting implementation. Use when the user asks to triage incoming bugs or ideas, clarify a task, add acceptance criteria, classify dependencies and risks, or move sufficiently clear work to READY.
---

# Triage Inbox

Clarify Beads tasks only. Do not edit product code, claim tasks, create branches,
or start implementation.

## Select Tasks

Use task IDs supplied by the user. Otherwise show the INBOX and ask which tasks
to triage only when processing all of them would be excessive:

```text
bd list --status open --label stage:inbox --sort created --json
```

Read each selected task with:

```text
bd show TASK-ID --long
```

## Prepare Each Task

1. Refine the title without removing important scope.
2. Rewrite the description into clear sections:
   - Context
   - Current behavior
   - Expected behavior
   - Reproduction steps for a bug
   - Affected modules
   - Parallel execution constraints
   - Dependencies
   - Risks
   - Open questions
   - Original report
3. Add testable acceptance criteria in the Beads acceptance field.
4. Search for duplicates and related tasks. Link uncertain matches with
   relates-to. Use a duplicate relationship only when the duplication is clear.
5. Add blocking dependencies in the correct direction:

```text
bd dep add BLOCKED-TASK BLOCKER-TASK
```

6. Synchronize:
   - native type with type:bug, type:feature, or type:chore;
   - native task plus type:research for research;
   - native priority with priority:P0 through priority:P3;
   - one primary area label.
7. Record product, security, data-loss, cross-platform, deployment, and
   training-science risks when applicable.
8. Compare the task with open in_progress and blocked work. Record overlapping
   files, APIs, schemas, mobile contracts, training formulas, and deployment
   surfaces. Add a blocking dependency when safe execution requires ordering.

Use non-interactive update flags. For a multiline description, create a unique
temporary UTF-8 file under the operating system's temporary directory, verify
that exact path, pass it with --body-file, and delete only that exact file. Do
not use bd edit.

## READY Gate

Move a task from INBOX to READY only when all are true:

- the title and expected result are unambiguous;
- acceptance criteria are present and testable;
- reproduction steps exist for a bug, or the task is explicitly reframed as a
  bounded investigation with acceptance criteria for finding the cause;
- affected modules and verification expectations are stated;
- parallel execution constraints and overlapping active work are stated;
- dependencies are represented in Beads;
- type, area, and priority are reasonable;
- no unresolved product decision prevents implementation;
- any training-methodology decision has the required NotebookLM evidence or is
  explicitly scoped as research.

Transition:

```text
bd update TASK-ID --remove-label stage:inbox --add-label stage:ready --status open
```

If the task is not ready, leave stage:inbox and append the exact open questions.
If a real external blocker prevents progress, set status blocked and explain
what will unblock it.

## Response

For each task, report:

- ID and refined title
- type, area, and priority
- resulting stage
- acceptance criteria summary
- dependencies and risks
- unresolved questions

End by stating that no code was changed and implementation was not started.
