import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Exercise, ProgramExercise } from '@/lib/prisma-client';
import { SetInput } from './set-input';

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
  createdAt: new Date(),
};

const pe: ProgramExercise & { exercise: Exercise } = {
  id: 'pe',
  workoutId: 'w',
  exerciseId: 'e1',
  order: 1,
  targetDropSets: 0,
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

function renderSetInput(unit: 'KG' | 'LB' = 'KG') {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <SetInput
      programExercise={pe}
      existingSets={[]}
      lastPerformance={undefined}
      readiness={null}
      deloadActive={false}
      unit={unit}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('SetInput quick entry', () => {
  it('prefills the deterministic next-set recommendation after a completed set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const previousSet = {
      localId: 'l1',
      sessionId: 's1',
      exerciseId: 'e1',
      setNumber: 1,
      weight: 100,
      reps: 12,
      rir: 2,
      notes: null,
      isWarmup: false,
      isDropSet: false,
      createdAt: Date.now() - 120_000,
      status: 'synced' as const,
      serverId: 'set1',
      syncedAt: Date.now(),
      attempts: 0,
      lastError: null,
    };

    render(
      <SetInput
        programExercise={pe}
        existingSets={[previousSet]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        recommendation={{
          mode: 'PRESERVE_RIR',
          weight: 100,
          reps: 11,
          rir: 2,
          reason: 'adjust-reps',
          predictedRepsAtSameLoad: 11,
          fatigueLoss: 1,
          confidence: 'medium',
        }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/100 KG × 11 · RIR 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 11, rir: 2 }),
    );
  });

  it('fills weight, reps, and RIR from a valid shorthand', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), '100x8@9');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, rir: 1 }),
    );
  });

  it('keeps the RIR untouched when the shorthand has no RPE', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), '62.5x8');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      // targetRIR (2) comes from the default pre-fill and must survive.
      expect.objectContaining({ weight: 62.5, reps: 8, rir: 2 }),
    );
  });

  it('converts the shorthand weight from the display unit (lb) to kg', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('LB');

    await user.type(screen.getByLabelText('Quick entry'), '225x5');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    const submitted = onSubmit.mock.calls[0]?.[0] as { weight: number };
    // 225 lb = 102.06 kg.
    expect(submitted.weight).toBeCloseTo(102.06, 1);
  });

  it('shows an inline format hint on invalid non-empty input', async () => {
    const user = userEvent.setup();
    renderSetInput('KG');

    expect(screen.queryByText(/expected format/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Quick entry'), 'squat');
    expect(screen.getByText(/expected format/i)).toBeInTheDocument();
  });

  it('does not touch the form values on an invalid entry', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), 'nonsense');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    // Defaults still submit: mid rep range (8), target RIR (2), weight 0.
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, reps: 8, rir: 2 }));
  });
});

// Cardio mode (issue #133): the logger swaps weight/reps for duration and
// optional distance and submits the normalized cardio payload.
const cardioExo: Exercise = {
  ...exo,
  id: 'e2',
  name: 'Running',
  muscleGroup: 'OTHER',
  category: 'CARDIO',
};

const cardioPE: ProgramExercise & { exercise: Exercise } = {
  ...pe,
  id: 'pe2',
  exerciseId: 'e2',
  targetSets: 1,
  exercise: cardioExo,
};

function renderCardioInput() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <SetInput
      programExercise={cardioPE}
      existingSets={[]}
      lastPerformance={undefined}
      readiness={null}
      deloadActive={false}
      unit="KG"
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe('SetInput cardio mode', () => {
  it('shows duration/distance inputs instead of load/reps', () => {
    renderCardioInput();
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/distance/i)).toBeInTheDocument();
    expect(screen.queryByText(/load \(/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quick entry')).not.toBeInTheDocument();
    expect(screen.queryByText(/reps in reserve/i)).not.toBeInTheDocument();
  });

  it('submits duration in seconds and distance in meters with weight 0 / reps 1', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCardioInput();

    await user.type(screen.getByLabelText(/duration/i), '12:30');
    await user.type(screen.getByLabelText(/distance/i), '2.5');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        weight: 0,
        reps: 1,
        rir: null,
        durationSec: 750,
        distanceM: 2500,
        isWarmup: false,
        isDropSet: false,
      }),
    );
  });

  it('keeps the log button disabled until the duration is valid', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCardioInput();

    const button = screen.getByRole('button', { name: /log the set/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/duration/i), '12:30');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 750, distanceM: null }),
    );
  });

  it('strength submissions carry null cardio fields (pinned)', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText('Quick entry'), '100x8');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, durationSec: null, distanceM: null }),
    );
  });

  it('preserves a restored cardio draft through completed-set hydration and reseeds after logging', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onFormChange = vi.fn();
    const restoredForm = {
      weight: 0,
      reps: 1,
      rir: null,
      durationInput: '12:30',
      distanceInput: '2.5',
      isWarmup: false,
      isDropSet: false,
      notes: 'restored cardio note',
    };
    const props = {
      programExercise: cardioPE,
      lastPerformance: undefined,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      restoredForm,
      onFormChange,
      onSubmit,
    };
    const { rerender, unmount } = render(<SetInput {...props} existingSets={[]} />);

    expect(screen.getByLabelText(/duration/i)).toHaveValue('12:30');
    expect(screen.getByLabelText(/distance/i)).toHaveValue(2.5);
    expect(screen.getByLabelText(/note/i)).toHaveValue('restored cardio note');

    rerender(
      <SetInput
        {...props}
        existingSets={[
          {
            localId: 'hydrated-cardio',
            sessionId: 'session',
            exerciseId: cardioExo.id,
            setNumber: 1,
            weight: 0,
            reps: 1,
            rir: null,
            durationSec: 300,
            distanceM: 1000,
            notes: null,
            isWarmup: false,
            isDropSet: false,
            createdAt: Date.now(),
            status: 'synced',
            serverId: 'server-cardio',
            syncedAt: Date.now(),
            attempts: 0,
            lastError: null,
          },
        ]}
      />,
    );

    expect(screen.getByLabelText(/duration/i)).toHaveValue('12:30');
    expect(screen.getByLabelText(/distance/i)).toHaveValue(2.5);

    await user.clear(screen.getByLabelText(/duration/i));
    await user.type(screen.getByLabelText(/duration/i), '15:00');
    await user.clear(screen.getByLabelText(/distance/i));
    await user.type(screen.getByLabelText(/distance/i), '3');
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    await waitFor(() =>
      expect(onFormChange).toHaveBeenLastCalledWith(
        cardioExo.id,
        expect.objectContaining({
          durationInput: '15:00',
          distanceInput: '3',
          notes: '',
        }),
      ),
    );

    const nextForm = onFormChange.mock.calls.at(-1)?.[1];
    unmount();
    render(<SetInput {...props} restoredForm={nextForm} existingSets={[]} />);
    expect(screen.getByLabelText(/duration/i)).toHaveValue('15:00');
    expect(screen.getByLabelText(/distance/i)).toHaveValue(3);
  });

  it('keeps the restored cardio draft when the parent reports that no set was saved', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    const onFormChange = vi.fn();
    const restoredForm = {
      weight: 0,
      reps: 1,
      rir: null,
      durationInput: '18:00',
      distanceInput: '4.2',
      isWarmup: false,
      isDropSet: false,
      notes: 'keep after local failure',
    };
    render(
      <SetInput
        programExercise={cardioPE}
        existingSets={[]}
        lastPerformance={undefined}
        readiness={null}
        deloadActive={false}
        unit="KG"
        restoredForm={restoredForm}
        onFormChange={onFormChange}
        onSubmit={onSubmit}
      />,
    );
    await waitFor(() => expect(onFormChange).toHaveBeenCalled());
    onFormChange.mockClear();

    await user.click(screen.getByRole('button', { name: /log the set/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/duration/i)).toHaveValue('18:00');
    expect(screen.getByLabelText(/distance/i)).toHaveValue(4.2);
    expect(screen.getByLabelText(/note/i)).toHaveValue('keep after local failure');
    expect(onFormChange).not.toHaveBeenCalled();
  });

  it('restores the next cardio exercise without attributing the outgoing draft to it', async () => {
    const user = userEvent.setup();
    const onFormChange = vi.fn();
    let resolveSubmit: ((saved: boolean) => void) | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const firstDraft = {
      weight: 0,
      reps: 1,
      rir: null,
      durationInput: '10:00',
      distanceInput: '2',
      isWarmup: false,
      isDropSet: false,
      notes: 'first exercise',
    };
    const nextExercise = {
      ...cardioPE,
      id: 'pe3',
      exerciseId: 'e3',
      exercise: { ...cardioExo, id: 'e3', name: 'Cycling' },
    };
    const nextDraft = {
      ...firstDraft,
      durationInput: '22:00',
      distanceInput: '8.5',
      notes: 'next exercise',
    };
    const commonProps = {
      existingSets: [],
      lastPerformance: undefined,
      readiness: null,
      deloadActive: false,
      unit: 'KG' as const,
      onFormChange,
      onSubmit,
    };
    const { rerender } = render(
      <SetInput {...commonProps} programExercise={cardioPE} restoredForm={firstDraft} />,
    );
    onFormChange.mockClear();

    await user.click(screen.getByRole('button', { name: /log the set/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    rerender(<SetInput {...commonProps} programExercise={nextExercise} restoredForm={nextDraft} />);
    resolveSubmit?.(true);

    await waitFor(() => expect(screen.getByLabelText(/duration/i)).toHaveValue('22:00'));
    expect(screen.getByLabelText(/distance/i)).toHaveValue(8.5);
    expect(onFormChange).not.toHaveBeenCalledWith(nextExercise.exerciseId, firstDraft);
    await waitFor(() =>
      expect(onFormChange).toHaveBeenCalledWith(nextExercise.exerciseId, nextDraft),
    );
  });
});

// Opt-in AI free-text parse (issue #210): a deliberate action that fills the
// form from a validated parse, never auto-logs, and degrades gracefully when
// the (untrusted) model output cannot be used.
describe('SetInput AI parse', () => {
  function stubFetch(parsed: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => ({ parsed }) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fills weight, reps and RIR from a strength parse, then logs on confirm', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch({ kind: 'strength', weight: 100, reps: 8, rir: 2 });
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText(/describe the set/i), '100 for 8, 2 left');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));

    // The request targets the parse route with the exercise id and text.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sets/parse');
    expect(JSON.parse(init.body as string)).toEqual({
      exerciseId: 'e1',
      text: '100 for 8, 2 left',
    });

    // Nothing logged yet - the user must confirm.
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ weight: 100, reps: 8, rir: 2 }),
    );
  });

  it('converts the parsed display-unit weight to kg (lb user)', async () => {
    const user = userEvent.setup();
    stubFetch({ kind: 'strength', weight: 225, reps: 5 });
    const { onSubmit } = renderSetInput('LB');

    await user.type(screen.getByLabelText(/describe the set/i), '225 for 5');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));
    await user.click(screen.getByRole('button', { name: /log the set/i }));

    const submitted = onSubmit.mock.calls[0]?.[0] as { weight: number };
    expect(submitted.weight).toBeCloseTo(102.06, 1); // 225 lb
  });

  it('fills nothing and shows a hint on a null parse (never logs garbage)', async () => {
    const user = userEvent.setup();
    stubFetch(null);
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText(/describe the set/i), 'how do I squat?');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));

    expect(screen.getByText(/could not parse that/i)).toBeInTheDocument();

    // The defaults survive untouched: nothing was filled from the bad parse.
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, reps: 8, rir: 2 }));
  });

  it('ignores a cardio parse on a strength exercise (wrong shape)', async () => {
    const user = userEvent.setup();
    stubFetch({ kind: 'cardio', durationSec: 1500 });
    const { onSubmit } = renderSetInput('KG');

    await user.type(screen.getByLabelText(/describe the set/i), 'ran 5k');
    await user.click(screen.getByRole('button', { name: /parse with ai/i }));

    expect(screen.getByText(/could not parse that/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /log the set/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ weight: 0, reps: 8 }));
  });
});
