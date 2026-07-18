export const PROGRAM_DESIGN_METHODOLOGY_VERSION = '2026-07-18.1';

export const PROGRAM_DESIGN_RULES = {
  authority: [
    'health-and-safety',
    'user-goals-and-constraints',
    'deterministic-gymcoach-metrics',
    'llm-interpretation',
  ],
  sourceBacked: [
    'Individualize training from goals, experience, performance and recovery.',
    'Progressive overload is required over time but is not linear every session.',
    'Use RIR or RPE with objective performance instead of fixed percentages alone.',
    'Require a feasible schedule, session duration and actual equipment before prescribing a program.',
    'Use a structured safety status and never treat illness, injury, surgery or unusual pain as an ordinary programming variable.',
    'Most hypertrophy work should stop short of failure; failure is selective and more conservative on compound movements.',
    'Distribute high weekly volume across sessions because per-session returns diminish.',
    'Do not convert strength from a related exercise into an exact load for another movement.',
    'Reduce training stress when performance and recovery signals deteriorate together.',
    'Treat pain, illness and medical red flags outside automatic training optimization.',
    'Available equipment and practical load increments constrain exercise selection and progression.',
    'Self-reported painful, injured, forbidden or discouraged exercises constrain exercise selection until the trainee changes that information.',
  ],
  engineeringHeuristics: {
    perMuscleSessionSoftCapSets: 10,
    weeklyVolumeStartingRangeSets: [10, 20],
    persistentUnderRecoveryVolumeReductionPct: 20,
    postBlockWarningSignalsForLoadReduction: 2,
    defaultPhaseLengthWeeks: 6,
    compoundFailureDefaultAllowed: false,
  },
  forbiddenClaims: [
    'Do not calculate or claim an exact muscle catabolism percentage.',
    'Do not calculate or claim an exact CNS fatigue score or overtraining threshold.',
    'Do not present product thresholds as universal physiological laws.',
    'Do not invent injuries, equipment, records, completed sets or user preferences.',
  ],
} as const;

export const PROGRAM_DESIGN_METHODOLOGY = `GymCoach program-design methodology, version ${PROGRAM_DESIGN_METHODOLOGY_VERSION}.

Decision order:
1. Health and safety boundaries.
2. The trainee's explicit goal, constraints, schedule and preferences.
3. Deterministic GymCoach metrics and equipment availability.
4. LLM interpretation.

Source-backed principles:
- Individualize from training experience, recent performance, adherence and recovery.
- Progressive overload is gradual and non-linear. Do not add work when the trainee is already progressing.
- Use actual weight, reps and RIR/RPE trends. A single poor session is not a plateau.
- Compare actual RIR with programmed RIR. Repeatedly training materially harder than prescribed is a recovery-cost signal, not automatic evidence that the program needs more volume.
- Most working sets should stop short of failure. Never make failure the default for complex compound lifts.
- Related exercises may show that a muscle stayed trained, but they do not provide an exact load conversion.
- High volume should be distributed across sessions. More than about 10 hard sets for one primary muscle in one session is a soft warning for diminishing returns, not an absolute physiological prohibition.
- Poor recovery plus declining performance calls for holding or reducing stress, not adding volume.
- Pain, illness, injury rehabilitation and medical red flags are outside automatic program optimization.
- Available equipment constrains exercise selection. Different physical machines are not exact load equivalents.

Engineering heuristics:
- Use 10-20 weekly hard sets per primary muscle only as a starting range that must be individualized.
- When under-recovery returns soon after a deload, a roughly 20% reduction in baseline weekly sets is a conservative starting adjustment.
- Two or more worsening items in the post-block sleep, motivation, performance, life-stress and aches checklist trigger a conservative load-reduction state. This is a product heuristic, not a diagnosis of overtraining.
- Use six weeks as the default phase length when the trainee gives no event date or preferred duration.
- Treat exact date windows, readiness cutoffs, e1RM equations and fatigue coefficients as revisable product rules.
- Treat plate compatibility pools, nullable inventory quantities and per-machine load multipliers as explicit GymCoach engineering configuration, not universal training science.

Source-backed intake principle: a usable program requires the goal, training experience, realistic schedule, session-duration limit, actual equipment and a current safety/constraint status. Ordinary return after a scheduling gap uses recent exposure and tolerated performance; illness, injury, surgery, unusual pain and medical restrictions are not automatic-programming inputs.

Engineering product rule: require specific available weekdays, session duration, equipment and one structured safety status. Derive feasible weekly frequency from the exact days unless the current request explicitly supplies a lower count. When ordinary training is cleared with limitations, require the approved limitations. When medical clearance is needed, block automatic generation and refer the trainee to an appropriate qualified professional. Extending or revising a block also requires the post-block recovery checklist.

Structured coaching-profile product rule: persisted fields keep explicit UNKNOWN, KNOWN and, where meaningful, NOT_APPLICABLE states plus server-owned update timestamps. Exact weekdays determine feasible frequency, historical sessions never fill a missing schedule or duration limit, and explicit request answers override profile defaults only for that request. Every named exercise attached to a pain, injury, forbidden or discouraged limitation is a hard validator exclusion. The enum names, JSON version, field bounds, exact-name matching and clarification workflow are engineering heuristics, not clinical classifications.

Recommended, non-blocking questions cover exact goal priorities, schedule constraints, exercise preferences, concurrent sport/cardio/physical work, recent training outside GymCoach, movement/RIR familiarity and changes since the source program. Missing optional context lowers specificity; it must never be invented. Rolling history, session RPE, recorded rest, personal volume targets and physical gym inventory are supplied when available.

Never claim to calculate exact muscle catabolism, glycogen depletion, CNS fatigue or an overtraining threshold. Use the supplied local-recovery, systemic-recovery, volume-pressure, RIR-adherence, session-density, performance-trend and data-confidence signals instead. Metrics listed as unavailable must not be invented. Explain every material change and keep generated programs as drafts until the trainee confirms them.`;
