import { z } from 'zod';
import { generatedProgramSchema } from '@/lib/schemas/program-generation';
import { databaseIdSchema } from '@/lib/schemas/gym-equipment';
import {
  coachingHealthStatusSchema,
  coachingTrainingLevelSchema,
} from '@/lib/schemas/coaching-profile';

export const programDesignModeSchema = z.enum(['NEW_PROGRAM', 'NEXT_MESOCYCLE', 'REVISE_CURRENT']);
export const trainingExperienceSchema = coachingTrainingLevelSchema;
export const programHealthStatusSchema = coachingHealthStatusSchema;

export const availableTrainingDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Training days must be unique.')
  .transform((days) => [...days].sort((a, b) => a - b));

export const postBlockAssessmentSchema = z.object({
  dreadingTraining: z.boolean(),
  sleepWorse: z.boolean(),
  performanceDecreasing: z.boolean(),
  lifeStressHigher: z.boolean(),
  achesAndPainsWorse: z.boolean(),
});

export const programDesignAnswersSchema = z
  .object({
    trainingExperience: trainingExperienceSchema.optional(),
    weeklyFrequency: z.number().int().min(1).max(7).optional(),
    sessionDurationMin: z.number().int().min(20).max(240).optional(),
    healthStatus: programHealthStatusSchema.optional(),
    phaseLengthWeeks: z.number().int().min(3).max(16).optional(),
    availableDays: availableTrainingDaysSchema.optional(),
    scheduleConstraints: z.string().trim().max(1000).optional(),
    limitations: z.string().trim().max(1000).optional(),
    excludedExercises: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .refine(
        (values) => new Set(values.map((value) => value.toLocaleLowerCase())).size === values.length,
        'Excluded exercise names must be unique.',
      )
      .optional(),
    equipmentAccess: z.string().trim().max(1000).optional(),
    preferences: z.string().trim().max(1000).optional(),
    recentTrainingBackground: z.string().trim().max(1500).optional(),
    goalPriorities: z.string().trim().max(1000).optional(),
    concurrentTraining: z.string().trim().max(1000).optional(),
    changesSinceLastProgram: z.string().trim().max(1000).optional(),
    postBlockAssessment: postBlockAssessmentSchema.optional(),
  })
  .strict();

export const programDesignRequestSchema = z
  .object({
    goal: z.string().trim().max(2000).default(''),
    mode: programDesignModeSchema.default('NEW_PROGRAM'),
    sourceProgramId: databaseIdSchema.optional(),
    answers: programDesignAnswersSchema.optional(),
  })
  .strict();

export const programDraftValidationInputSchema = programDesignRequestSchema.extend({
  program: generatedProgramSchema,
});

export type ProgramDesignMode = z.infer<typeof programDesignModeSchema>;
export type TrainingExperience = z.infer<typeof trainingExperienceSchema>;
export type ProgramHealthStatus = z.infer<typeof programHealthStatusSchema>;
export type PostBlockAssessment = z.infer<typeof postBlockAssessmentSchema>;
export type ProgramDesignAnswers = z.infer<typeof programDesignAnswersSchema>;
export type ProgramDesignRequest = z.infer<typeof programDesignRequestSchema>;
