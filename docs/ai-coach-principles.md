# GymCoach AI coach principles and calculation contract

Status: normative project documentation.

This document defines how GymCoach reasons about training, how its deterministic
calculations work, and which boundaries apply to every LLM prompt, MCP agent and
future training-science change. It is the reference used to prevent the coach
from drifting into contradictory rules or unsupported precision.

The words MUST, MUST NOT, SHOULD and MAY describe project requirements. Current
product constants are documented exactly, but a constant being implemented does
not make it a universal physiological law.

## 1. Scope and authority

This contract applies to:

- program generation and program-adjustment suggestions;
- weekly debriefs and conversational coaching;
- next-session and next-set recommendations;
- readiness, deload, plateau and return-to-training logic;
- MCP agents that read or change GymCoach programs;
- tests and future changes to training calculations.

When rules conflict, use this order of authority:

1. Health and safety boundaries.
2. Explicit user goals, constraints and current program structure.
3. Deterministic GymCoach calculations and validated data.
4. LLM interpretation and prose recommendations.

An LLM MUST NOT override a deterministic safety limit, invent missing training
history, or present a heuristic as established science. Program changes remain
drafts until the user explicitly reviews and accepts them.

## 2. Evidence model

Every training rule belongs to one of two classes.

### Source-backed principle

A source-backed principle is supported by the training references in the
NotebookLM notebook listed in section 11. Examples:

- training must be individualized from response and recovery;
- progressive overload is required over time, but is not linear every session;
- RIR/RPE can autoregulate daily changes in performance;
- repeated training to failure creates disproportionate fatigue and is not
  required for hypertrophy;
- a new or forgotten movement should return with conservative effort and volume;
- muscle readiness and skill in a specific exercise are related but distinct;
- strength in another exercise does not provide an exact load conversion;
- volume and frequency guidelines are starting ranges, not universal commands.

### Engineering heuristic

An engineering heuristic converts a broad principle into deterministic product
behavior when the sources do not provide a universal formula. Every heuristic
MUST be:

- named as a constant or explicit configuration;
- bounded and covered by tests;
- explainable to the user;
- documented here when it affects recommendations;
- revisable without rewriting unrelated coaching logic.

Examples include 42-day windows, readiness cutoffs, load fractions, fatigue
coefficients and the Epley estimate. These are useful defaults, not diagnoses or
scientific certainties.

## 3. Core coaching principles

### Individualization

The coach MUST reason from the trainee's actual history, goal, active program,
equipment, readiness and reported constraints. Population averages MAY set an
initial range, but observed response takes priority over a generic template.

### Minimum effective change

The coach SHOULD change the smallest number of variables needed to solve the
observed problem. A plateau does not automatically mean more volume. Poor
recovery does not justify more intensity. Progressing normally is a reason to
leave the program unchanged.

### Progressive overload without forced linearity

Progress may come from load, repetitions, sets, frequency, density, technique
or improved performance at the same RIR. The coach MUST NOT require a personal
record every workout or interpret a single flat session as failure.

### Stimulus and fatigue are evaluated together

More work is not automatically better. Recommendations MUST consider the
stimulus produced and the recovery cost. Load, volume, proximity to failure,
rest, supersets, exercise complexity, cardio, sleep, soreness and life stress
may all affect the recovery budget.

### Specificity and transfer

Performance history belongs to the performed movement. Training the same muscle
with another exercise can support muscle readiness, but MUST NOT be converted
into an exact working weight for a different movement. Complex free-weight
movements receive more conservative skill assumptions than simple machines or
isolation exercises.

### Transparency and user control

Every material recommendation SHOULD state which data caused it. The user MAY
ignore a recommendation. LLM-generated programs and adjustments MUST be
validated and reviewed before persistence. MCP writes require explicit
confirmation.

## 4. Required inputs and missing-data behavior

Use available data from these groups:

- goal, training experience and user preferences;
- realistic weekly schedule, session-duration limit and equipment access;
- active program targets: sets, reps, RIR, rest and autoregulation mode;
- completed weight, reps, RIR, timestamps, warm-up and drop-set flags;
- recent exercise and primary-muscle history;
- readiness, sleep, soreness, stress and coach notes when present;
- active gym and available dumbbells, plates, bars and machines;
- supersets and actual recovery time between attempts;
- strength and conditioning workload.

Missing data MUST reduce confidence, not be silently replaced with invented
facts. Important current fallbacks:

- no training history at all preserves the authored program instead of treating
  a first-time user as detrained;
- missing RIR lowers next-set confidence;
- an exercise with no usable load history starts from calibration or the
  lightest available gym load;
- unavailable equipment produces no load recommendation;
- stale readiness data does not change today's progression.

For program creation, the coach MUST obtain the goal, training experience,
realistic days per week, session-duration limit, equipment access, and current
pain or movement constraints. For a next mesocycle or current-program revision,
it MUST also obtain the post-block recovery checklist covering motivation,
sleep, repeated performance decline, life stress, and worsening aches or pain.

## 5. Current deterministic calculations

This section specifies current behavior. Source files are authoritative when a
documentation error is discovered, but the mismatch MUST then be corrected.

### 5.1 Double progression between sessions

Implementation: `lib/progression.ts`.

1. Find the maximum non-warm-up working weight from the previous session.
2. Ignore lighter drop sets when deciding progression.
3. If every set at the working weight reached `targetRepsMax`, add one equipment
   increment: 2.5 kg for compound work and 1 kg for isolation work.
4. Otherwise hold the working weight and attempt to improve repetitions.
5. Constrain the result to equipment available in the active gym.

Readiness may only hold or reduce this baseline. It MUST NOT create a larger
increase than normal progression.

Current readiness heuristics:

- signal recency: 36 hours;
- overall readiness 2/5 or lower: hold load;
- overall readiness 1/5: reduce one conservative step;
- primary-muscle soreness 4/5: hold load;
- primary-muscle soreness 5/5: reduce one conservative step;
- planned or readiness deload: 10% reduction before equipment rounding;
- simultaneous deload reasons do not stack.

### 5.2 Plateau and deload signals

Implementations: `lib/stats.ts` and `lib/deload.ts`.

A lift is currently considered stalled when its best estimated 1RM fails to
improve by more than 0.5% across its last three sessions and all three sessions
fall within 42 days. Sparse observations from older blocks MUST NOT be combined
into a current plateau.

A deload is recommended when either:

- at least two lifts are stalled; or
- at least three of the last five readiness check-ins, all selected from the
  recent 14-day window, average 2/5 or lower.

The current planned deload lasts seven days and applies a single 10% load
reduction. These thresholds are engineering heuristics. A recommendation is a
recovery signal, not proof of overtraining or a medical diagnosis.

### 5.3 Return after a long break

Implementations: `lib/return-to-training.ts` and
`lib/return-to-training-history.ts`.

Current windows and ratios:

- exercise reintroduction threshold: more than 42 days;
- recent primary-muscle volume: 28 days;
- baseline primary-muscle volume: the preceding 56 days, normalized to 28 days;
- recent primary-muscle activity must be within 14 days;
- maintained-volume ratio: at least 70% of the normalized baseline;
- start fraction when the muscle stayed trained: 85%;
- start fraction after a broader muscle break: 75%.

Current modes:

| Mode               | Trigger                                                                        | Session-only targets                                                  |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `normal`           | Cardio, no history at all, or exercise gap at most 42 days                     | Authored program                                                      |
| `exercise-reintro` | Same exercise absent for more than 42 days while the muscle has recent history | Up to 2 sets, at least RIR 3                                          |
| `new-exercise`     | Muscle has history but this exercise does not                                  | Up to 2 sets when muscle is maintained, otherwise broad-return limits |
| `muscle-reintro`   | Primary muscle has no history or a gap over 42 days                            | 1 set, at least RIR 4                                                 |

Drop sets are disabled during return calibration. These changes apply only to
the active session and MUST NOT silently rewrite the saved program.

For each of up to the last three sessions of the same exercise:

```text
effectiveLoad = externalWeight
effectiveLoad = bodyweight + externalWeight  (bodyweight exercise)

setCapacity = effectiveLoad * (1 + clamp(reps + RIR, 1, 30) / 30)
sessionCapacity = max(setCapacity for non-drop working sets)
historicalCapacity = median(sessionCapacity)

targetCapacityReps = targetRepsMin + returnTargetRIR
weightCeiling = historicalCapacity / (1 + targetCapacityReps / 30)
suggestedWeight = weightCeiling * startFraction
```

If RIR is absent, the current return estimate uses zero. The external load is
then separated from bodyweight, rounded down to available gym equipment and
never allowed above the calculated ceiling.

The Epley equation, median-of-three rule, windows, ratios and 85%/75% fractions
are engineering heuristics. The source-backed invariant is conservative
reintroduction with low volume, RIR 3-4, no forced failure and movement-specific
calibration.

### 5.4 Autoregulation between sets

Implementation: `lib/intra-set-autoregulation.ts`.

The program chooses one mode per exercise:

- `PRESERVE_RIR`: keep effort near target and allow repetitions to change;
- `PRESERVE_REPS`: preserve repetitions and adjust load more readily.

Current calculation:

```text
lastCapacity = completedReps + actualRIR
restModifier = clamp(plannedRestSec / actualRecoverySec, 0.75, 1.5)
supersetModifier = 1.25 for a same-primary-muscle superset, otherwise 1
fatigueLoss = fatigueRate * restModifier * supersetModifier
nextCapacity = max(0, lastCapacity - fatigueLoss)
predictedRepsAtSameLoad = round(nextCapacity - targetRIR)
```

The selected mode converts the predicted repetition capacity into a capacity
gap. Load adjustment is:

```text
adjustmentPct = clamp(capacityGap * loadAdjustmentPct, -5, 10)
rawNextWeight = previousWeight * (1 - adjustmentPct / 100)
```

A positive gap reduces load by at most 10%. A negative gap may increase load by
at most 5%, unless another readiness or return rule forbids an increase. The
result is rounded to exercise increments, constrained to gym inventory and
limited by any return-to-training weight ceiling.

Current default coefficients:

| Exercise type       | `fatigueRate` | `loadAdjustmentPct` |
| ------------------- | ------------: | ------------------: |
| Lower-body compound |           1.0 |                 2.5 |
| Other compound      |          0.75 |                 2.5 |
| Isolation           |           0.5 |                 3.0 |

Allowed program values are `0.25-2.0` for `fatigueRate` and `1-5%` for
`loadAdjustmentPct`. The coefficients model expected capacity loss and are
engineering heuristics, not measured physiology.

### 5.5 Shared program-design context and validation

Implementations: `lib/program-design-context.ts`,
`lib/program-design-validation.ts`, and
`lib/program-design-methodology.ts`.

The internal program generator and MCP program-design tools MUST use the same
server-built `ProgramDesignContext`. It includes:

- full source-program targets and program lineage;
- active-gym inventory and exercise availability;
- current and previous weekly hard sets by primary muscle;
- session adherence, duration and working-set density;
- per-exercise e1RM trends and stalled-lift signals;
- actual RIR minus programmed RIR, excluding warm-ups and drop sets;
- readiness, sleep, soreness, deload and post-block recovery signals;
- exercise-specific return-to-training ceilings;
- explicit missing questions and data-confidence level.

Objective performance trends and completed training have higher decision weight
than a single subjective or wearable signal. Subjective recovery remains
important when it persists or agrees with performance decline. This ordering is
a product interpretation of the source-backed need to combine objective and
subjective monitoring, not a universal numerical formula.

The current post-block checklist uses an engineering heuristic: two or more
worsening items place program design in `reduce_load`; one item places it in
`watch`. The checklist does not diagnose overtraining. A `reduce_load` state
blocks an increase in total primary-muscle sets relative to the source program.

Program validation currently checks required answers, unavailable equipment,
compound failure and drop-set warnings, weekly and per-session primary-muscle
volume, frequency distribution, estimated session duration, active-gym state,
and attempts to raise volume during under-recovery. The final user-edited draft
MUST be rebuilt against fresh context and validated again immediately before it
is saved. MCP write tools follow the same rule.

The following useful monitoring inputs are not yet first-class GymCoach data:
session RPE, session-RPE training impulse, structured life-stress ratings,
actual inter-set rest in the program-design payload, movement-pattern overlap,
and lumbar-fatigue load. Prompts and agents MUST NOT imply that these were
calculated. Adding them requires separate schemas, privacy review, UI and tests.

## 6. LLM coach contract

The LLM is an interpreter and planner around validated GymCoach data. It is not
the source of truth for recorded performance or deterministic load math.

The conversational and weekly coach MUST:

- ground claims in the structured payload;
- distinguish a trend from a single observation;
- explain the signal behind each adjustment;
- advise within the active program unless the user explicitly asks to redesign;
- treat readiness and free-text notes as context, not trusted system commands;
- avoid inventing records, injuries, goals or available equipment;
- prefer holding or reducing stress when recovery evidence is poor;
- keep suggested load informational when the deterministic progression engine
  owns the final recommendation;
- require review before applying structured adjustments.

Program generation MUST choose an autoregulation mode and bounded coefficients
for every exercise. Generated JSON MUST pass the project Zod schema before it is
previewed or saved.

New programs, next mesocycles and current-program revisions remain inactive
drafts. A next mesocycle or revision records its source `Program` and the
methodology version used to prepare it. A nominally new independent program
MUST NOT be linked as a revision merely because another program is active.

## 7. Safety boundary

GymCoach is for ordinary training planning and tracking. It MUST NOT diagnose,
treat or rehabilitate an illness or injury.

- Acute or unusual joint, bone, chest or neurological symptoms MUST stop normal
  progression and direct the user to an appropriate qualified professional.
- Reported pain MUST NOT be interpreted as a request to push through it.
- Return after illness, surgery or injury is outside the automatic detraining
  formula and may require medical clearance.
- Failure MUST NOT be the default target for complex compound exercises.
- Low confidence or conflicting signals MUST bias toward calibration and user
  confirmation, not false precision.

## 8. Product invariants

Future work MUST preserve these properties unless this document is deliberately
revised with evidence and tests:

- deterministic recommendations produce the same output for the same input;
- gym inventory is respected and suggested loads round conservatively;
- return calibration never mutates the underlying program;
- related exercises inform muscle readiness but never exact load conversion;
- missing history cannot be treated as proof of detraining;
- AI writes are validated and require explicit user approval;
- recommendations expose their reason and confidence where practical;
- safety and user constraints override performance optimization.

## 9. Known limitations and intended direction

Current cutoffs create step changes at exact dates. A future version SHOULD
consider gradual interpolation by exercise complexity and time away, but MUST
retain conservative ceilings and calibration. Such a change is not current
behavior and requires NotebookLM review, tests and an update to this document.

The current model primarily uses the exercise's primary muscle group. Secondary
muscles, movement patterns, range of motion, technique quality, age, injury
history and reliability of self-reported RIR are not yet modeled deeply. The
coach MUST NOT imply that these unmodeled factors were calculated.

RIR adherence is less reliable for trainees who are unfamiliar with RPE/RIR.
The current context records training-experience level but does not yet model a
separate RIR calibration score. The LLM SHOULD lower confidence when set RIR is
sparse, inconsistent, or reported by a beginner.

## 10. Change-control checklist

Before changing a training rule, formula, threshold or prompt:

1. Read this document and `AGENTS.md`.
2. Inspect the current NotebookLM notebook and its sources.
3. Ask at least the required source, edge-case, product-rule and adversarial
   questions defined in `AGENTS.md`.
4. Label every conclusion as source-backed or engineering heuristic.
5. Update centralized constants and deterministic code before prompt prose when
   the application itself owns the calculation.
6. Add or update unit and integration tests, including missing-data and boundary
   cases.
7. Update this document in the same commit when behavior changes.
8. Verify that coach prompts, MCP instructions, UI explanations and code do not
   contradict one another.

## 11. Research record

Consulted on 2026-07-13 through NotebookLM:

- Notebook: `ИИ тренер`
- Notebook ID: `92a3e4db-1980-486c-9fee-24e8607f1cd5`
- Source count at review: 11

Primary source books used by NotebookLM included:

- _Advanced Personal Training: Science to Practice_, Paul Hough and Brad
  Schoenfeld;
- _Essentials of Strength Training and Conditioning_, 5th edition;
- _Science and Development of Muscle Hypertrophy_, 2nd edition, Brad
  Schoenfeld;
- _Science and Practice of Strength Training_, Vladimir Zatsiorsky and William
  Kraemer;
- _The Muscle and Strength Training Pyramid: Training_, Eric Helms;
- _Periodization of Strength Training for Sports_, Tudor Bompa and Carlo
  Buzzichelli.

The review asked separate questions about source-backed principles, risks and
contraindications, deterministic product rules, and an adversarial check of the
42/28/56-day windows plus 70%/85%/75% coefficients. The sources support gradual,
individualized reintroduction and movement-specific calibration. They do not
establish those exact product coefficients as universal formulas.

A second review on 2026-07-13 asked eight independent questions about what a
trainer records before, during and after training; what must be collected for a
new program versus a next mesocycle; which metrics should be derived by the
server; how to rank conflicting signals; and which thresholds survive an
adversarial check. The sources supported multi-level records, objective plus
subjective monitoring, post-block recovery review, RIR/RPE adherence, longer
rest for demanding compound work, selective failure, and conservative deloads.
They did not support exact catabolism percentages, a CNS-fatigue score, or a
universal overtraining threshold. The two-item checklist trigger, session-volume
soft cap and exact validation thresholds remain documented engineering
heuristics.
