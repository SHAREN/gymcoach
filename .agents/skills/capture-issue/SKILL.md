---
name: capture-issue
description: Capture a new GymCoach bug, idea, feature request, chore, or research need in the authoritative Beads INBOX and mirror it safely to GitHub without interrupting active implementation. Use for an ordinary implementation request routed automatically by AGENTS.md, when the user asks to add something to the queue or remember it for later, or when an unrelated discovery must be recorded.
---

# Capture Issue

Create one durable Beads task. Do not edit product code, switch branches, claim
work, create a Codex task, or alter the currently active task.

## Workflow

1. Read AGENTS.md and docs/CODEX_WORKFLOW.md.
2. Run bd prime and bd where. Confirm the resolved shared workspace before any
   write.
3. Normalize the input:
   - Preserve the original text or transcript in the description.
   - If the input is audio, transcribe it with available transcription tooling
     before capture. If transcription is unavailable, ask for text.
   - Never store secrets, tokens, private keys, raw environment values, or
     personal data. Replace them with [REDACTED] and note that a security
     redaction was made.
4. Search open and closed tasks for explicit duplicates:

```text
bd search "short distinctive phrase" --status all --json
bd list --status open,in_progress,blocked --json
```

If an open task is an obvious duplicate, do not create another task. Preserve
the new report as a timestamped comment on the existing task, using the same
security redaction and unique temporary-file rules. Return the existing ID and
state that no new task was created. Do not change the existing task's stage,
priority, assignee, or active implementation.

Use:

```text
bd comment EXISTING-ID --file PATH
```

If the obvious match is closed, do not reopen it automatically. Create a new
INBOX task only when the report represents a recurrence or new evidence, and
link it with relates-to.

5. Classify preliminarily:
   - Native type bug, feature, or chore when applicable.
   - Native type task plus type:research for research.
   - One primary area label: web, android, backend, shared, or infrastructure.
   - Native priority P0 through P3 plus the matching priority label.
6. Create a concise title and a description containing:
   - Original report
   - Preliminary interpretation
   - Known context
   - Open questions
7. Create the task with stage:inbox and synchronized labels. For multiline
   input, create a unique temporary UTF-8 body file under the operating
   system's temporary directory, verify that exact path, pass it through
   --body-file, then delete only that exact file.

Example shape:

```text
bd create "Short title" --type bug --priority P2 --labels "stage:inbox,type:bug,priority:P2,area:android" --body-file PATH
```

8. If another task is a probable but not certain duplicate, keep both tasks and
   add a non-blocking relationship:

```text
bd dep add NEW-ID POSSIBLE-ID --type relates-to
```

Do not merge or delete probable duplicates automatically.

9. Mirror the new or matched task after the Beads mutation succeeds:

```text
node scripts/sync-beads-github.mjs --task TASK-ID
```

The mirror is idempotent by exact Beads ID, persists the GitHub issue URL in
external_ref, and must not receive raw notes, logs, private paths, credentials,
tokens, device identifiers, or personal data. A GitHub failure does not roll
back or duplicate the authoritative Beads task. Report it as a partial failure
and leave the task available for a safe retry.

## Priority Rules

- P0: data loss, critical vulnerability, or complete loss of a core function.
- P1: important function broken while the application remains partly usable.
- P2: ordinary bug or meaningful improvement.
- P3: cosmetic issue, idea, or technical debt.

If P0 is only suspected, capture it as P0 but state that confirmation is
required before it may interrupt active work.

## Response

Return only a short result in this shape:

```text
Created TASK-ID.
Type: bug
Area: android
Priority: P2
Stage: INBOX
The active task was not changed.
```

If GitHub mirroring failed, append:

```text
GitHub mirror: partial failure; Beads remains authoritative and no duplicate task was created.
```

For a suspected P0, append:

```text
P0 interruption requires explicit confirmation.
```

For an obvious open duplicate, use:

```text
Matched existing TASK-ID.
The new report was preserved as a comment.
No new task was created.
The active task was not changed.
```
