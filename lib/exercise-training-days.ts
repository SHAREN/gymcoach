import { getDateKeyInTimeZone } from '@/lib/history-calendar';

export type TrainingDatesByExercise = Record<string, string[]>;

export interface ExerciseTrainingDateRow {
  exerciseId: string;
  session: { startedAt: Date };
}

export function groupTrainingDatesByExercise(
  rows: readonly ExerciseTrainingDateRow[],
): TrainingDatesByExercise {
  const datesByExercise: TrainingDatesByExercise = {};
  for (const row of rows) {
    (datesByExercise[row.exerciseId] ??= []).push(row.session.startedAt.toISOString());
  }
  return datesByExercise;
}

export function countTrainingDaysByExercise(
  datesByExercise: TrainingDatesByExercise,
  timeZone: string,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(datesByExercise).map(([exerciseId, dates]) => {
      const dayKeys = new Set<string>();
      for (const value of dates) {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) {
          dayKeys.add(getDateKeyInTimeZone(date, timeZone));
        }
      }
      return [exerciseId, dayKeys.size];
    }),
  );
}
