import { z } from 'zod';
import { generatedProgramSchema } from '@/lib/schemas/program-generation';

export const programDesignModeSchema = z.enum(['NEW_PROGRAM', 'NEXT_MESOCYCLE', 'REVISE_CURRENT']);

export const trainingExperienceSchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);

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
  phaseLengthWeeks: z.number().int().min(3).max(16).optional(),
  limitations: z.string().trim().max(1000).optional(),
  equipmentAccess: z.string().trim().max(1000).optional(),
  preferences: z.string().trim().max(1000).optional(),
  postBlockAssessment: postBlockAssessmentSchema.optional(),
});

export const programDesignRequestSchema = z.object({
  goal: z.string().trim().min(10, 'Describe your goal in a bit more detail.').max(2000),
  mode: programDesignModeSchema.default('NEW_PROGRAM'),
  sourceProgramId: z.string().cuid().optional(),
  answers: programDesignAnswersSchema.optional(),
});

export const generatedProgramBuildInputSchema = z.object({
  program: generatedProgramSchema,
  goal: z.string().trim().min(10).max(2000),
  mode: programDesignModeSchema.default('NEW_PROGRAM'),
  sourceProgramId: z.string().cuid().nullable().optional(),
  answers: programDesignAnswersSchema.optional(),
  methodologyVersion: z.string().trim().max(80).nullable().optional(),
});

export type ProgramDesignMode = z.infer<typeof programDesignModeSchema>;
export type TrainingExperience = z.infer<typeof trainingExperienceSchema>;
export type PostBlockAssessment = z.infer<typeof postBlockAssessmentSchema>;
export type ProgramDesignAnswers = z.infer<typeof programDesignAnswersSchema>;
export type ProgramDesignRequest = z.infer<typeof programDesignRequestSchema>;
