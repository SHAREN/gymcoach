---
name: integrate-tasks
description: Integrate one root GymCoach request's independently verified Beads tasks in dependency order, run combined gates, validate runtime artifacts, close tasks through the deterministic guard, mirror final state to GitHub, and optionally publish the verified integration branch as a draft PR. Use after required tasks reach stage:verified.
---

# Integrate Tasks

Integrate verified work without editing task Worktrees or reopening implementation.
This is the only normal product-task closure path.

## Preflight

1. Read AGENTS.md, CLAUDE.md, docs/CODEX_WORKFLOW.md, and the complete
   verify-task skill.
2. Run bd prime and inspect every required task with bd show and bd dep list.
3. Require every product task to be in_progress with stage:verified and to have
   immutable verification notes containing its exact verified base, verified
   commit, gate commands, and artifact impact.
4. Record the current integration base. Inspect active tasks, every relevant
   branch/Worktree, and newer verified product lines before selecting the base.
5. Create or use one dedicated integration Worktree and branch. Prefer:

```text
codex/integration-ROOT-TASK-ID
```

Never integrate directly on main/master, never write in a task Worktree, and
never use a stale whole-file copy to resolve a conflict.

## Integrate

1. Order required tasks by Beads dependencies.
2. Record `authority.rootTaskId` and the complete requiredTaskIds set in the
   integration manifest. The guard rereads the live root and transitive
   `blocks` dependencies and must reject a missing or unexpected verified task.
   Do not include context-only relates-to or discovered-from links.
3. Integrate exact verified commits with reviewed merge, rebase, cherry-pick, or
   focused conflict resolution.
   A cherry-pick produces a different commit identity, so record it as a
   behavior-equivalent replacement unless the original verified commit also
   becomes an ancestor through a merge.
4. For every verified commit, record one manifest mapping:
   - ancestor: the exact verified commit is an ancestor of the integration head;
   - behavior-equivalent: replacement commits are ancestors and an independent
     reviewer records a mapping ID and concrete review evidence.
5. Preserve both valid change sets when resolving conflicts. Rerun every gate
   affected by the combined result.
6. Do not mark a missing commit equivalent merely because the integration build
   passes. Behavior equivalence requires explicit review evidence.

Use the checked-in fixtures under scripts/fixtures/integration-evidence as the
manifest schema examples. Keep the real manifest and signature outputs out of
Git unless a prepared task explicitly requires a sanitized committed artifact.

## Combined Gates And Delivery Evidence

Run the canonical web/backend/shared gate and every additional gate required by
the combined diff. Record the command, exact integration head, and exit code.
Before closure, obtain a separate integration review of the combined diff and
artifact evidence. Record the reviewer, exact head, passed result, and concise
review evidence in integration.review.

For Android-affecting work, build and publish again from the integration head.
An APK from a task Worktree is never closure evidence. Record:

- output-metadata.json versionName and versionCode;
- app-debug.apk and the immutable hash-qualified APK;
- actual file size and SHA-256;
- latest.json consistency;
- apksigner --print-certs output for both APK paths;
- the exact integration head used for the build.

Create an untracked evidence directory and record both signing reports with the
Android SDK apksigner executable:

```text
apksigner verify --print-certs android/app/build/outputs/apk/debug/app-debug.apk > evidence/debug-apksigner.txt
apksigner verify --print-certs data/android-release/HASH-QUALIFIED.apk > evidence/immutable-apksigner.txt
```

If apksigner is not on PATH, locate the exact executable under the configured
Android SDK build-tools directory and record that resolved tool version in the
integration review. Do not substitute a declared fingerprint without tool
output.

Keep delivery stages distinct in the manifest:

```text
integrated
published
installed
deployed
```

Do not infer installation or deployment. Mark an unauthorized optional stage
not-authorized. If any task acceptance criteria require installation or
deployment, keep that stage required and pending; guarded closure must fail
until evidence exists. The guard derives these requirements from the live Beads
acceptance criteria for the root and blocking graph; manifest task booleans are
only descriptive and cannot weaken a requirement. Count only direct obligations
such as "must be installed", "is installed", or "must be deployed". Conditional
policy text, hypothetical criteria, state-separation wording, prohibitions, and
unauthorized/optional statements do not create a delivery requirement.

## Guarded Closure

Validate without mutation first:

```text
node scripts/check-integration-evidence.mjs --manifest PATH
node scripts/close-integrated-tasks.mjs --manifest PATH --dry-run
```

The guard must reject any required task whose verified commit exists only on a
task branch, unless a reviewed behavior-equivalent mapping is complete. It must
also reject missing Android publication, hash, latest.json, or signing evidence.

After the combined result has received its required independent integration
review, close through the wrapper only:

```text
node scripts/close-integrated-tasks.mjs --manifest PATH
```

The wrapper validates again, requires stage:verified, closes Beads, then mirrors
the closed state and sanitized evidence to the exact GitHub issue. Beads remains
authoritative. A GitHub partial failure must be reported and retried without
reopening or corrupting the successfully closed Beads task.

The wrapper closes mapped verified tasks in dependency order and closes any
root coordination task last. It never limits closure checks to task IDs supplied
only by the manifest.

Retry only the failed mirror after Beads is already closed:

```text
node scripts/close-integrated-tasks.mjs --manifest PATH --mirror-only --dry-run
node scripts/close-integrated-tasks.mjs --manifest PATH --mirror-only
```

The mirror-only dry-run performs the same read-only exact-marker,
external_ref, duplicate, label, and issue-reuse planning as the real retry. It
must fail before reporting success when the real retry would fail.

Legacy tasks that were closed before this workflow are never silently reopened
or rewritten. Add them to the integration audit. A missing legacy commit must be
flagged and blocks the root request until it is integrated or explicitly mapped.

## GitHub Publication

Only after guarded integration and independent verification, and only when the
owner has authorized publication, validate the publication plan:

```text
node scripts/publish-integration-draft.mjs --manifest PATH --dry-run
```

Then run the same command without --dry-run. It may push only the current
dedicated codex/ or task branch to origin SHAREN/gymcoach and create or update a
draft PR against main. Never push an unverified writer branch, never auto-merge,
and never treat a draft PR as deployment evidence.

## Result

Report:

- integration branch and head;
- exact task mappings;
- combined gates;
- integrated, published, installed, and deployed states separately;
- guarded Beads closures and GitHub mirror results;
- draft PR URL only if publication was authorized and succeeded.

Keep the integration Worktree while it remains the current source or current
integration line. After guarded closure, any authorized draft publication, and
an explicit no-longer-needed decision, let the preserved Project Dispatcher
capture a fresh complete live Codex thread snapshot and run:

```text
node scripts/cleanup-obsolete-worktree.mjs --manifest PATH
node scripts/cleanup-obsolete-worktree.mjs --manifest PATH --apply
```

Never self-remove from the integration thread. The cleanup guard must preserve
active, dirty, owner-preserved, REVIEW/VERIFY, current source/integration,
Git-locked, and main/master Worktrees; archive an otherwise unreachable full
immutable HEAD before non-forced `git worktree remove`; and report Windows
residual locks without unsafe fallback deletion.
