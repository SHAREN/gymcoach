import { describe, expect, it } from 'vitest';
import {
  countTrainingDaysByExercise,
  groupTrainingDatesByExercise,
} from './exercise-training-days';

describe('exercise training days', () => {
  it('groups finished-session timestamps by exercise', () => {
    expect(
      groupTrainingDatesByExercise([
        { exerciseId: 'bench', session: { startedAt: new Date('2026-07-01T08:00:00Z') } },
        { exerciseId: 'row', session: { startedAt: new Date('2026-07-02T08:00:00Z') } },
        { exerciseId: 'bench', session: { startedAt: new Date('2026-07-03T08:00:00Z') } },
      ]),
    ).toEqual({
      bench: ['2026-07-01T08:00:00.000Z', '2026-07-03T08:00:00.000Z'],
      row: ['2026-07-02T08:00:00.000Z'],
    });
  });

  it('counts distinct user-local calendar days and ignores duplicate same-day sessions', () => {
    const dates = {
      bench: ['2026-07-01T00:30:00.000Z', '2026-07-01T18:00:00.000Z', '2026-07-02T01:00:00.000Z'],
      unused: [],
    };

    expect(countTrainingDaysByExercise(dates, 'Asia/Yekaterinburg')).toEqual({
      bench: 2,
      unused: 0,
    });
    expect(countTrainingDaysByExercise(dates, 'America/Los_Angeles')).toEqual({
      bench: 2,
      unused: 0,
    });
  });

  it('deduplicates timestamps that cross UTC midnight but share one local date', () => {
    expect(
      countTrainingDaysByExercise(
        {
          bench: ['2026-07-01T23:30:00.000Z', '2026-07-02T01:30:00.000Z'],
        },
        'Asia/Yekaterinburg',
      ),
    ).toEqual({ bench: 1 });
  });
});
