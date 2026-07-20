import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getFinishedExerciseTrainingDates } from './exercise-usage';

vi.mock('@/lib/db', () => ({
  db: {
    sessionExercise: {
      findMany: vi.fn(),
    },
  },
}));

describe('getFinishedExerciseTrainingDates', () => {
  beforeEach(() => {
    vi.mocked(db.sessionExercise.findMany).mockReset();
  });

  it('uses durable finished-session exercise membership scoped to the user', async () => {
    vi.mocked(db.sessionExercise.findMany).mockResolvedValue([
      {
        exerciseId: 'bench',
        session: { startedAt: new Date('2026-07-01T08:00:00.000Z') },
      },
    ] as never);

    await expect(getFinishedExerciseTrainingDates('user-1')).resolves.toEqual({
      bench: ['2026-07-01T08:00:00.000Z'],
    });
    expect(db.sessionExercise.findMany).toHaveBeenCalledWith({
      where: {
        session: {
          userId: 'user-1',
          finishedAt: { not: null },
        },
      },
      select: {
        exerciseId: true,
        session: { select: { startedAt: true } },
      },
    });
  });
});
