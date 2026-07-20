'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  countTrainingDaysByExercise,
  type TrainingDatesByExercise,
} from '@/lib/exercise-training-days';

export function useExerciseTrainingDays(
  trainingDatesByExercise: TrainingDatesByExercise,
): Record<string, number> {
  const [timeZone, setTimeZone] = useState('UTC');

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, []);

  return useMemo(
    () => countTrainingDaysByExercise(trainingDatesByExercise, timeZone),
    [timeZone, trainingDatesByExercise],
  );
}
