import { describe, expect, it } from 'vitest';
import {
  availableTrainingDaysSchema,
  programDesignAnswersSchema,
  programDesignRequestSchema,
} from './program-design';

describe('program design schemas', () => {
  it('normalizes exact available weekdays and rejects duplicates', () => {
    expect(availableTrainingDaysSchema.parse([5, 1, 3])).toEqual([1, 3, 5]);
    expect(availableTrainingDaysSchema.safeParse([1, 1]).success).toBe(false);
  });

  it('shares the structured coaching-profile health and experience enums', () => {
    expect(
      programDesignAnswersSchema.parse({
        healthStatus: 'TRAIN_WITH_LIMITATIONS',
        trainingExperience: 'ADVANCED',
      }),
    ).toMatchObject({
      healthStatus: 'TRAIN_WITH_LIMITATIONS',
      trainingExperience: 'ADVANCED',
    });
    expect(
      programDesignAnswersSchema.safeParse({ healthStatus: 'NO_RELEVANT_CONCERNS' }).success,
    ).toBe(false);
  });

  it('keeps request answers bounded and rejects duplicate exact exclusions', () => {
    expect(
      programDesignRequestSchema.safeParse({
        mode: 'NEW_PROGRAM',
        answers: { excludedExercises: ['Bench Press', 'bench press'] },
      }).success,
    ).toBe(false);
    expect(
      programDesignRequestSchema.parse({
        mode: 'NEXT_MESOCYCLE',
        goal: 'Build the next phase',
        answers: { availableDays: [6, 2, 4] },
      }).answers?.availableDays,
    ).toEqual([2, 4, 6]);
  });
});
