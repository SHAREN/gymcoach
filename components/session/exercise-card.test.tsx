import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { READINESS_RECENCY_HOURS, type ReadinessSignal } from '@/lib/progression';
import { ExerciseCard } from './exercise-card';
import type { SerializedLastPerformance } from './session-runner';

const exo: Exercise = {
  id: 'e1',
  userId: 'u',
  name: 'Squat',
  muscleGroup: 'QUADS',
  category: 'COMPOUND',
  defaultRestSec: 120,
  notes: null,
  usesBodyweight: false,
  equipmentType: 'BARBELL',
  catalogOrigin: null,
  loadProfile: {},
  createdAt: new Date(),
};

const pe: ProgramExercise & { exercise: Exercise } = {
  id: 'pe',
  workoutId: 'w',
  exerciseId: 'e1',
  order: 1,
  targetSets: 3,
  targetRepsMin: 6,
  targetRepsMax: 10,
  targetRIR: 2,
  restSec: 120,
  tempo: null,
  notes: null,
  supersetGroup: null,
  autoregulationMode: 'PRESERVE_RIR',
  fatigueRate: null,
  loadAdjustmentPct: null,
  exercise: exo,
};

// Last session: every working set hit the top of the rep range, so the base
// rule wants to progress (+2.5 kg). Readiness can then hold or step that down.
const lastPerf: SerializedLastPerformance = {
  sessionStartedAt: new Date().toISOString(),
  sets: [
    { weight: 100, reps: 10, rir: 1 },
    { weight: 100, reps: 10, rir: 1 },
    { weight: 100, reps: 10, rir: 1 },
  ],
  maxWeight: 100,
  repsAtMaxWeight: 10,
  cardio: null,
};

function renderCard(readiness: ReadinessSignal | null, deloadActive = false) {
  return render(
    <ExerciseCard
      programExercise={pe}
      lastPerformance={lastPerf}
      readiness={readiness}
      deloadActive={deloadActive}
      unit="KG"
    />,
  );
}

describe('ExerciseCard readiness explainer', () => {
  it('shows no readiness note when there is no check-in (unchanged UI)', () => {
    renderCard(null);
    expect(screen.queryByText(/Held -/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lighter -/)).not.toBeInTheDocument();
  });

  it('shows a "Held" note when readiness holds the load', () => {
    // readiness 2 -> hold (no progression), but not a deload.
    renderCard({ readiness: 2, soreness: null, ageHours: 1 });
    expect(screen.getByText('Held - low readiness today')).toBeInTheDocument();
    expect(screen.queryByText(/Lighter -/)).not.toBeInTheDocument();
  });

  it('shows a "Lighter" note when readiness steps the load down', () => {
    // readiness 1 -> deload (step-down).
    renderCard({ readiness: 1, soreness: null, ageHours: 1 });
    expect(screen.getByText('Lighter - low readiness today')).toBeInTheDocument();
  });

  it('names reported soreness as the cause when soreness drives the hold', () => {
    // Good overall readiness but the trained muscle is sore -> hold via soreness.
    renderCard({ readiness: 5, soreness: { QUADS: 4 }, ageHours: 1 });
    expect(screen.getByText('Held - reported soreness')).toBeInTheDocument();
  });

  it('shows no note when the check-in is stale (out of the recency window)', () => {
    renderCard({ readiness: 1, soreness: null, ageHours: READINESS_RECENCY_HOURS + 1 });
    expect(screen.queryByText(/Held -/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Lighter -/)).not.toBeInTheDocument();
  });

  it('explains the planned deload week when one is active', () => {
    // No readiness signal at all: the planned deload alone drives the note,
    // and the suggested load steps down 10% from the 100 kg working weight.
    renderCard(null, true);
    expect(screen.getByText('Lighter - planned deload week')).toBeInTheDocument();
    expect(screen.getByText('90 kg')).toBeInTheDocument();
  });
});

describe('ExerciseCard compact session presentation', () => {
  it('does not duplicate exercise technique notes, muscle/category labels, or prior-history details', () => {
    const compactExercise: Exercise = {
      ...exo,
      notes: 'Technique cue belongs on the exercise detail page',
    };
    render(
      <ExerciseCard
        programExercise={{ ...pe, exercise: compactExercise }}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Squat' })).toBeInTheDocument();
    expect(
      screen.queryByText('Technique cue belongs on the exercise detail page'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Quadriceps')).not.toBeInTheDocument();
    expect(screen.queryByText('Compound')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last session/)).not.toBeInTheDocument();
  });

  it('shows only a meaningful program note and hides importer-only metadata', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const meaningful = {
      ...pe,
      notes:
        'Alpha prescription: 4 sets; 10 reps\nKeep elbows tucked and stop if the wrist hurts.\nAlpha metadata: Superset 2',
    };
    const view = render(
      <ExerciseCard
        programExercise={meaningful}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
      />,
    );

    await user.click(screen.getByRole('button', { name: /notes/i }));
    expect(screen.getByText('Keep elbows tucked and stop if the wrist hurts.')).toBeInTheDocument();
    expect(screen.queryByText(/Alpha prescription/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Alpha metadata/)).not.toBeInTheDocument();

    view.rerender(
      <ExerciseCard
        programExercise={{ ...pe, notes: '4 sets x 8 reps; RIR 2; rest 90' }}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
      />,
    );
    expect(screen.queryByRole('button', { name: /notes/i })).not.toBeInTheDocument();
  });

  it('keeps gym context and unavailable state visible because they affect the live workout', () => {
    render(
      <ExerciseCard
        programExercise={pe}
        lastPerformance={lastPerf}
        readiness={null}
        deloadActive={false}
        unit="KG"
        gymName="Main gym"
        loadConstraints={{
          equipmentType: 'BARBELL',
          isAvailable: false,
          dumbbellWeights: [],
          plateWeights: [],
          barWeights: [],
          weightOptions: [],
        }}
      />,
    );
    expect(screen.getByText('Main gym')).toBeInTheDocument();
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
  });
});
