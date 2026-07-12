export const PROGRAM_DESIGN_METHODOLOGY_VERSION = '2026-07-13.2';

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
    'Most hypertrophy work should stop short of failure; failure is selective and more conservative on compound movements.',
    'Distribute high weekly volume across sessions because per-session returns diminish.',
    'Do not convert strength from a related exercise into an exact load for another movement.',
    'Reduce training stress when performance and recovery signals deteriorate together.',
    'Treat pain, illness and medical red flags outside automatic training optimization.',
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

Engineering heuristics:
- Use 10-20 weekly hard sets per primary muscle only as a starting range that must be individualized.
- When under-recovery returns soon after a deload, a roughly 20% reduction in baseline weekly sets is a conservative starting adjustment.
- Two or more worsening items in the post-block sleep, motivation, performance, life-stress and aches checklist trigger a conservative load-reduction state. This is a product heuristic, not a diagnosis of overtraining.
- Use six weeks as the default phase length when the trainee gives no event date or preferred duration.
- Treat exact date windows, readiness cutoffs, e1RM equations and fatigue coefficients as revisable product rules.

Required planning inputs are the goal, realistic weekly schedule, training experience, session-duration limit, equipment access and current pain or movement constraints. Extending a block also requires the post-block recovery checklist.

Never claim to calculate exact muscle catabolism, glycogen depletion, CNS fatigue or an overtraining threshold. Use the supplied local-recovery, systemic-recovery, volume-pressure, RIR-adherence, session-density, performance-trend and data-confidence signals instead. Metrics listed as unavailable must not be invented. Explain every material change and keep generated programs as drafts until the trainee confirms them.`;
