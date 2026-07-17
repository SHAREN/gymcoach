import { db } from '@/lib/db';
import {
  groupTrainingDatesByExercise,
  type TrainingDatesByExercise,
} from '@/lib/exercise-training-days';

export async function getFinishedExerciseTrainingDates(
  userId: string,
): Promise<TrainingDatesByExercise> {
  const rows = await db.sessionExercise.findMany({
    where: {
      session: {
        userId,
        finishedAt: { not: null },
      },
    },
    select: {
      exerciseId: true,
      session: { select: { startedAt: true } },
    },
  });

  return groupTrainingDatesByExercise(rows);
}
