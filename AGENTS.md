# AGENTS.md - GymCoach agent instructions

Read and follow `CLAUDE.md` for the repository architecture, code conventions,
verification gate, security rules, and Git workflow. The requirements below
apply to every coding or analysis agent working in this repository.

Before changing or explaining any training calculation, also read
`docs/ai-coach-principles.md`. It is the normative contract for source-backed
principles, engineering heuristics, current formulas and safety boundaries.

## Canonical runtime and deployment

- GymCoach must have exactly one canonical runtime on the Home PC:
  `http://192.168.0.119:3030`. The public production URL
  `https://gymcoach7.sharteman.duckdns.org` must proxy to that runtime.
- Temporary development or preview ports are allowed only while work is in
  progress. Isolated verification does not complete a product task. Product
  tasks may close only after guarded integration and any required runtime
  artifact publication. Installation and deployment remain separate facts.
  The root request is production-complete only after an explicitly authorized
  deployment reaches canonical `3030`; otherwise report the exact integrated,
  published, installed, and deployed states without leaving a temporary runtime.
- Before deploying, identify the exact checkout, commit, container and image
  currently backing `3030`. Inspect every relevant clone, worktree and branch
  for concurrent or newer changes, including `git status`, recent commits and
  diffs against the intended deployment source.
- Never replace newer work by copying whole files from a stale checkout or by
  rebuilding from an outdated branch. Integrate concurrent changes deliberately
  with an appropriate merge, rebase, cherry-pick or reviewed patch. Resolve
  conflicts according to behavior, preserve both valid change sets and rerun
  all affected verification gates after integration.
- Keep the previous working image or runtime state available for rollback.
  Deploy the integrated version, then health-check both
  `http://192.168.0.119:3030` and
  `https://gymcoach7.sharteman.duckdns.org` before removing temporary runtimes.
- Final deployment verification must confirm that `3030` is serving the latest
  integrated version and that no other GymCoach containers or listeners remain
  on temporary host ports such as `3031`, `3032` or `3033`.

## Mandatory training-science research workflow

Any question, design decision, algorithm, prompt, recommendation, or code change
about training methodology must be researched in NotebookLM before the agent
answers or implements it. This includes strength training, bodybuilding,
hypertrophy, exercise selection, volume, intensity, frequency, RIR/RPE,
progression, periodization, fatigue, recovery, deloads, detraining, returning
after a break, soreness, and workload management.

Use the existing NotebookLM notebook:

- Title: `ИИ тренер`
- Notebook ID: `92a3e4db-1980-486c-9fee-24e8607f1cd5`

Required workflow:

1. Inspect the notebook and its current sources before querying it.
2. Ask at least three distinct NotebookLM questions for each training-science
   topic. A single broad query is not sufficient.
   Run independent questions in parallel through lower-cost subagents when
   available. The main agent remains responsible for reconciling answers and
   distinguishing evidence from heuristics.
3. Include separate questions for:
   - source-backed principles and direct recommendations;
   - edge cases, risks, contraindications, and competing interpretations;
   - translation into a deterministic GymCoach algorithm or product rule.
4. For numerical thresholds or safety-relevant decisions, ask at least one
   additional adversarial question that challenges the proposed values and
   distinguishes direct source support from engineering heuristics.
5. Reuse the NotebookLM conversation ID for follow-up questions when useful so
   the answers can be refined and contradictions can be challenged.
6. In the final analysis, label claims as either `source-backed` or
   `engineering heuristic`. Do not present a generated formula or threshold as
   established science when the notebook sources do not specify it.
7. Record which notebook was consulted and summarize the evidence that drove
   the implementation or recommendation.
8. Update `docs/ai-coach-principles.md` in the same change whenever a training
   formula, threshold, prompt rule or safety boundary changes.

If NotebookLM is unavailable, explicitly report the problem. Do not finalize a
training-methodology decision by inventing evidence or silently substituting an
uncited assumption. Wait for access to be restored unless the user explicitly
authorizes a different research source.

## Health and safety boundary

GymCoach may adapt ordinary training after travel, scheduling gaps, or planned
rest, but it must not diagnose or treat illness or injury. Training-related
pain, post-illness return, and medical red flags require conservative product
language and referral to an appropriate qualified professional. NotebookLM
research does not replace medical clearance.

## Automatic development orchestration

A concrete request to add, change, fix, refactor, or remove project behavior
automatically authorizes the full local Beads and Codex workflow. The user does
not need to mention Project Dispatcher or type capture-issue, triage-inbox,
next-task, execute-task, verify-task, or integrate-tasks explicitly.

Questions, explanations, read-only reviews, and diagnostics without an
implementation request do not create tasks.

For every implementation request, the coordinating Codex task must:

1. Capture the request in Beads through capture-issue.
2. Triage it through triage-inbox with testable acceptance criteria, scope,
   risks, dependencies, and affected files or contracts.
3. Ask the user only when a material product decision, expected behavior,
   safety rule, or required external authority remains unresolved.
4. Split independently deliverable work into separate linked Beads tasks and
   represent required ordering or overlap as dependencies.
5. Record the local integration base before dispatch. For every READY child task
   belonging to the current root request, automatically create a dedicated Codex
   task, Git Worktree, and task branch, then dispatch execute-task with the Beads
   task ID.
6. Run independent tasks concurrently when their files, APIs, schemas, shared
   contracts, training formulas, deployment surfaces, and required ordering do
   not overlap.
7. Serialize overlapping or uncertain work. If overlap is discovered after
   execution starts, pause the newer task and block it on the earlier task.
8. Run verify-task as a separate pass for every implementation. Failed
   verification returns the task to its single write-owning implementation
   agent. Successful product verification records immutable base/commit
   evidence and moves the task to `stage:verified`; it does not close it.
9. Dispatch integrate-tasks after all required tasks are verified. Integrate
   their commits in dependency order into a dedicated integration Worktree,
   record conflict-resolution mappings, and rerun the combined gates. The
   integration guard rereads the authoritative Beads root and transitive
   blocking dependencies; manifest task lists and delivery booleans are never
   accepted as their own authority.
10. Close product tasks only through the deterministic integration closure
    guard. Report the root request with integrated, published, installed, and
    deployed states separately.

The coordinating task owns decomposition, dispatch, dependency management,
progress monitoring, and final integration. It must not edit implementation
files in child task Worktrees. Each task and Worktree has exactly one
write-owning implementation agent; parallel agents inside a task are limited to
read-only research, review, or verification.

When Codex thread automations are available and child work will outlive the
current turn, create or reuse one heartbeat for the coordinating task. Every
heartbeat must reread Beads and live task state, avoid duplicate writers or
verifiers, and stop after the root request completes or needs new authority.
Never hardcode a stale branch HEAD as the source of truth.

Dependency-ordered tasks that have not started remain `open + stage:ready` with
blocking dependencies. Native `blocked` is reserved for external/manual blockers
or paused work. Before resuming a legacy `blocked + stage:ready` task, validate
its dependencies and final base, return it to open, and confirm readiness.

New requests received while work is active are captured and scheduled without
interrupting active work. A P0 interrupts active work only after the user
explicitly confirms both the P0 classification and the interruption.

Automation normally ends at verified local integration. The owner has
authorized the integration workflow to push only a verified dedicated `codex/`
or task branch to `origin` and create or update a draft PR against
`SHAREN/gymcoach` `main`. Never push an unverified writer branch, auto-merge the
PR, merge main/master, deploy, restart production services, or synchronize Beads
data remotely. Without deployment authority, report the integrated result as
ready for deployment rather than production-complete.

If Codex cannot programmatically create the required Codex task or Worktree,
leave the Beads task READY and report the exact missing manual action. Never
fall back to implementing multiple tasks in one Worktree.

## Development task workflow

- Beads is the source of truth for project tasks. Follow
  docs/CODEX_WORKFLOW.md and use the repo-local skills under
  .agents/skills.
- The generated beads skill is orientation only. Its generic create, ready,
  claim, and close examples do not override GymCoach stages. Route every task
  mutation through capture-issue, triage-inbox, execute-task, verify-task, or
  integrate-tasks; use next-task for read-only selection.
- New bugs and ideas must be captured into INBOX before implementation.
- A new request must not interrupt the currently active task unless it is an
  explicitly confirmed P0 issue. Even a P0 is captured as a separate task
  first.
- Only READY tasks may be implemented.
- Each implementation task must use a separate Codex task, Git branch, and
  Worktree.
- Multiple READY tasks may run concurrently only when they use different Codex
  tasks, branches, and Worktrees and their affected files, APIs, schemas, and
  shared contracts do not overlap. Add a Beads dependency and serialize the
  work when overlap or ordering is uncertain.
- One implementation task has one write-owning agent. Do not run multiple
  agents that edit the same task or Worktree. Read-only research, review, and
  verification may be delegated in parallel.
- The Project Dispatcher is code-read-only but acts as the default coordinator.
  It may capture, triage, select, decompose, create child Worktree tasks,
  dispatch work, monitor results, and integrate verified commits. It must not
  edit product code or claim an implementation task itself.
- One task must produce one focused diff.
- Do not expand task scope. Capture unrelated findings as separate linked
  tasks.
- Do not modify product code during issue capture or triage.
- Do not work directly on main or master.
- Product verification ends at `stage:verified`. Do not call `bd close` directly.
  The normal close path is `scripts/close-integrated-tasks.mjs` after combined
  integration evidence passes against the live Beads dependency graph and
  acceptance criteria. Pure harness/docs work may use only the explicit
  deterministic no-runtime-artifact exception; Docker, runtime build,
  deployment, and artifact-publication files are not eligible for it.
- Do not expose, copy, log, or commit secrets, tokens, environment variables,
  private keys, or personal data. Task descriptions and verification notes are
  not exceptions.
- The historical docs/loops backlog and GitHub issue loop are not active task
  sources. Do not append new tasks to docs/loops/ideas-backlog.md.

## GitHub issue mirror and draft publication

- Beads remains authoritative. GitHub Issues in `SHAREN/gymcoach` are an
  idempotent external mirror keyed by the exact Beads ID.
- Capture and every lifecycle transition run
  `node scripts/sync-beads-github.mjs --task TASK-ID`. Backfill uses `--backfill`.
  Always inspect a `--dry-run` before a broad backfill.
- Persist the unique issue URL in Beads `external_ref`. If exact-ID duplicate
  issues exist, stop and report them rather than choosing or creating another.
- Mirror only sanitized status, stage, type, priority, area, acceptance criteria,
  and structured verification/integration/artifact evidence. Never mirror
  secrets, credentials, private paths, device identifiers, raw private logs,
  browser state, recordings, or personal data.
- A GitHub partial failure never rolls back or corrupts Beads. Retry the mirror
  idempotently. Close the GitHub issue only after guarded closure has closed the
  Beads task. A mirror-only dry-run must execute the same read-only duplicate,
  exact-marker, external_ref, label, and issue-reuse planning as the real retry.
- After independent integration verification, publication may use
  `scripts/publish-integration-draft.mjs`. It validates the integration manifest,
  origin, branch prefix, and `main` base before pushing and creating/updating a
  draft PR. It never merges the PR.

## Automation tool routing

Select automation by the capability required, while keeping repository-native
tests and gates authoritative:

- For browser development, deterministic web UI checks, and Playwright E2E
  authoring or debugging, use Playwright CLI with the project-local
  `.agents/skills/playwright-cli` skill.
- For an authenticated live Chrome tab that requires DOM, Network, Console, or
  performance inspection, prefer Chrome DevTools MCP when it is loaded and the
  session is authorized for the task.
- For Android or mobile UI flows, prefer Maestro CLI or Maestro MCP for
  repeatable automation and Mobile MCP for interactive device inspection and
  control. Use ADB for deterministic device state, logs, installation, and as
  the fallback when a mobile MCP is unavailable.
- Do not restart or duplicate an active task solely to load a newly installed
  MCP. Continue with an available CLI or ADB fallback; newly created tasks may
  use the MCP after the required Codex restart.
- These tools do not replace the canonical web, Android, Huawei, integration,
  or deployment gates. Preserve one writer per task and Worktree, record
  reproducible commands and outcomes, and distinguish automated evidence from
  manual or device-only observations.
- Treat authenticated sessions and device state as sensitive. Never expose or
  commit credentials, cookies, tokens, browser profiles, saved storage state,
  raw recordings or traces, or personal device data. Collect only the minimum
  sanitized evidence required by the acceptance criteria.

## Verification commands

The canonical web/backend/shared green-gate is:

```bash
bash scripts/verify.sh
```

On the current Home PC, bare bash resolves to WSL without Node. From
PowerShell, invoke the same canonical script through Git Bash:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh
```

It runs Prisma generation, lint, TypeScript type checking, unit/component
tests, and the production build. The full gate requires the test PostgreSQL on
port 5434 and runs integration and E2E tests:

```bash
bash scripts/verify.sh --full
```

On the current Home PC, run the full gate from PowerShell with:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh --full
```

When the changed area requires the full gate, unavailable prerequisites block
REVIEW, verification, and task closure. They are not optional evidence.

Useful individual commands are:

```bash
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run test:integration
npm run build
npm run test:e2e
npm run format:check
```

CI additionally builds and probes the production Docker image. Run the checks
required by the changed area and follow CLAUDE.md for the full gate contract.

## Android APK publishing gate

After any change to Android application code, resources, Gradle configuration
or Android version metadata, run the Android debug assembly before reporting
completion:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

assembleDebug automatically runs publishDebugApk, creating an immutable
hash-qualified APK in data/android-release and atomically replacing latest.json.
For product closure, repeat this gate from the final integration head and use
the integration guard to prove that versionName, versionCode, size, SHA-256,
signing certificate, app-debug.apk, immutable APK, and latest.json agree. An APK
built in an isolated task Worktree is insufficient. Do not leave the web
download pointing at a stale Android build.

Pure web changes do not require a new APK because the Android WebView loads the
web interface from the configured server.

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->

## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
node scripts/close-integrated-tasks.mjs --manifest PATH  # Guarded closure
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.
- Do not use the generic `bd close` shortcut for GymCoach product tasks.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

<!-- END BEADS CODEX SETUP -->
