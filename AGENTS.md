# AGENTS.md - GymCoach agent instructions

Read and follow `CLAUDE.md` for the repository architecture, code conventions,
verification gate, security rules, and Git workflow. The requirements below
apply to every coding or analysis agent working in this repository.

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
