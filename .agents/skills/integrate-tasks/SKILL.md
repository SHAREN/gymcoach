---
name: integrate-tasks
description: Integrate one root GymCoach request's independently verified Beads tasks in dependency order, run combined gates, validate runtime artifacts, close tasks through the deterministic guard, mirror final state to GitHub, and optionally publish the verified integration branch as a draft PR. Use after required tasks reach stage:awaiting-integration.
---

# Integrate Tasks

Integrate verified work without editing task Worktrees or reopening implementation.
This is the only normal product-task closure path.

## Preflight

1. Read AGENTS.md, CLAUDE.md, docs/CODEX_WORKFLOW.md, and the complete
   verify-task skill.
2. Run bd prime and inspect every required task with bd show and bd dep list.
3. Require every product task to be in_progress with stage:awaiting-integration and to have
   exactly matching `Immutable verification evidence v1` JSON containing its
   verified base, verified commit, gate command/head/exit, and artifact impact.
4. Record the current integration base. Inspect active tasks, every relevant
   branch/Worktree, and newer verified product lines before selecting the base.
5. Create or use one dedicated integration Worktree and branch. Prefer:

```text
codex/integration-ROOT-TASK-ID
```

Require the stateless Project Dispatcher to record the exact integration
task/role/thread/host/resolved-path-hash Worktree binding on the root Beads task
from real thread creation state before integration begins. Do not fabricate a
missing thread or host identity for cleanup.

If the root is coordination-only, require the authoritative
`role:integration-coordinator` label, `in_progress` status, no stage, and at
least one blocking dependency. Never infer this role from dependencies and
never close an INBOX, READY, or blocked product task as a coordinator.

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

Record the actual Android SDK `aapt`/`aapt2` and `apksigner` executable paths in
the untracked manifest. The guard invokes them directly against both APKs:

```text
aapt dump badging android/app/build/outputs/apk/debug/app-debug.apk
apksigner verify --print-certs android/app/build/outputs/apk/debug/app-debug.apk
aapt dump badging data/android-release/HASH-QUALIFIED.apk
apksigner verify --print-certs data/android-release/HASH-QUALIFIED.apk
```

Locate the exact executables under the configured Android SDK build-tools
directory and record their resolved tool versions in the integration review.
Do not substitute stored report text, a declared fingerprint, or arbitrary
bytes for direct tool execution and a structurally valid APK.

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

The wrapper validates again, requires stage:awaiting-integration, closes Beads, then mirrors
the closed state and sanitized evidence to the exact GitHub issue. Beads remains
authoritative. A GitHub partial failure must be reported and retried without
reopening or corrupting the successfully closed Beads task.

The wrapper closes mapped verified tasks in dependency order and closes any
root coordination task last. It never limits closure checks to task IDs supplied
only by the manifest.

It preplans the complete ordered closure before mutation. If the exact guarded
note was appended and all stages removed but `bd close` failed, the next retry
may classify only that exact allowed pre-close state as close-only, without
appending the note again. Duplicate/missing notes, remaining stages, unexpected
statuses, or any other partial state fail closed before further mutation.
The complete wrapper must rediscover that exact transient state by rerunning the
authoritative validator; direct planner-only tests are insufficient.

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

Only after guarded closure and independent verification, and only when the
owner has authorized publication, validate the publication plan:

```text
node scripts/publish-integration-draft.mjs --manifest PATH --dry-run
```

Then run the same command without --dry-run. It may push only the current
dedicated codex/ or task branch whose name contains a guarded Beads task ID to
the fixed origin SHAREN/gymcoach and create or update a draft PR against the
fixed main base. Repository/base overrides and unbound codex branches are
rejected. Never push an unverified writer branch, never force-push or
auto-merge, and never treat a draft PR as deployment evidence.

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
an explicit no-longer-needed decision, let the stateless Project Dispatcher
capture a fresh complete live Codex thread snapshot and run:

```text
node scripts/cleanup-obsolete-worktree.mjs --manifest PATH
node scripts/cleanup-obsolete-worktree.mjs --manifest PATH --apply
```

Never self-remove from the integration thread. The cleanup guard must preserve
active, dirty, owner-preserved, REVIEW/VERIFY, current source/integration,
Git-locked, and main/master Worktrees; archive an otherwise unreachable full
immutable HEAD before non-forced `git worktree remove`; and report Windows
residual locks without unsafe fallback deletion. Supply only a raw unfiltered
`codex_app.list_threads` response below its limit with no unavailable hosts,
and bind the derived task role to the exact Beads task/thread/host/path-hash
marker. Never substitute `wait_threads`, caller-declared flattened state, or a
manifest role. A residual pass accepts only the immutable Git receipt ref
created by the registered removal pass and revalidates identity, age, intent,
and current commit reachability.
