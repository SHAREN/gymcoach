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
  progress. After a feature passes its applicable verification gates, deploy
  the completed version to the canonical `3030` runtime before reporting the
  work complete. Do not leave the latest version available only on a temporary
  port, branch or working copy.
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

## Android APK publishing gate

After any change to Android application code, resources, Gradle configuration
or Android version metadata, run the Android debug assembly before reporting
completion:

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

`assembleDebug` automatically runs `publishDebugApk`, creating an immutable
hash-qualified APK in `data/android-release` and atomically replacing
`latest.json`. Verify that the published version, size and SHA-256 match the
newly built APK. Do not leave the web download pointing at a stale Android
build.

Pure web changes do not require a new APK because the Android WebView loads the
web interface from the configured server.
