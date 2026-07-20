import { z } from 'zod';
import { generatedProgramSchema } from '@/lib/schemas/program-generation';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import {
  coachingHealthStatusSchema,
  coachingTrainingLevelSchema,
} from '@/lib/schemas/coaching-profile';

export const programDesignModeSchema = z.enum(['NEW_PROGRAM', 'NEXT_MESOCYCLE', 'REVISE_CURRENT']);

export const trainingExperienceSchema = coachingTrainingLevelSchema;

const LEGACY_HEALTH_STATUS = {
  NO_RELEVANT_CONCERNS: 'NO_SIGNIFICANT_ISSUES',
  CLEARED_WITH_LIMITATIONS: 'TRAIN_WITH_LIMITATIONS',
  NEEDS_MEDICAL_CLEARANCE: 'MEDICAL_CLEARANCE_REQUIRED',
} as const;

export const programHealthStatusSchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value in LEGACY_HEALTH_STATUS
      ? LEGACY_HEALTH_STATUS[value as keyof typeof LEGACY_HEALTH_STATUS]
      : value,
  coachingHealthStatusSchema,
);

export const availableTrainingDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Training days must be unique.');

export const postBlockAssessmentSchema = z.object({
  dreadingTraining: z.boolean(),
  sleepWorse: z.boolean(),
  performanceDecreasing: z.boolean(),
  lifeStressHigher: z.boolean(),
  achesAndPainsWorse: z.boolean(),
});

export const programDesignAnswersSchema = z.object({
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
    )
    .optional(),
  equipmentAccess: z.string().trim().max(1000).optional(),
  preferences: z.string().trim().max(1000).optional(),
  recentTrainingBackground: z.string().trim().max(1500).optional(),
  goalPriorities: z.string().trim().max(1000).optional(),
  concurrentTraining: z.string().trim().max(1000).optional(),
  techniqueAndRirFamiliarity: z.string().trim().max(1000).optional(),
  changesSinceLastProgram: z.string().trim().max(1000).optional(),
  postBlockAssessment: postBlockAssessmentSchema.optional(),
});

export const programDesignRequestSchema = z.object({
  goal: z.string().trim().max(2000).default(''),
  mode: programDesignModeSchema.default('NEW_PROGRAM'),
  sourceProgramId: databaseIdSchema.optional(),
  answers: programDesignAnswersSchema.optional(),
});

export const generatedProgramBuildInputSchema = z.object({
  program: generatedProgramSchema,
  goal: z.string().trim().max(2000).default(''),
  mode: programDesignModeSchema.default('NEW_PROGRAM'),
  sourceProgramId: databaseIdSchema.nullable().optional(),
  answers: programDesignAnswersSchema.optional(),
  methodologyVersion: z.string().trim().max(80).nullable().optional(),
});

export type ProgramDesignMode = z.infer<typeof programDesignModeSchema>;
export type TrainingExperience = z.infer<typeof trainingExperienceSchema>;
export type ProgramHealthStatus = z.infer<typeof programHealthStatusSchema>;
export type PostBlockAssessment = z.infer<typeof postBlockAssessmentSchema>;
export type ProgramDesignAnswers = z.infer<typeof programDesignAnswersSchema>;
export type ProgramDesignRequest = z.infer<typeof programDesignRequestSchema>;
