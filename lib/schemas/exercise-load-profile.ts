import { z } from 'zod';
import { MuscleGroup } from '@/lib/prisma-client';

export const EXERCISE_LOAD_PROFILE_VERSION = 1 as const;
export const EXERCISE_LOAD_ALGORITHM_VERSION = '2026-07-18-multi-muscle-v1' as const;

export const exerciseLoadConfidenceValues = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export const exerciseLoadProvenanceValues = [
  'SYSTEM_CATALOG_REVIEW',
  'LEGACY_PRIMARY_MIGRATION',
  'USER_CLASSIFICATION',
  'BACKUP_IMPORT',
  'UNCLASSIFIED',
] as const;
export const exerciseLoadClassificationValues = [
  'REVIEWED',
  'LEGACY_PRIMARY_ONLY',
  'UNCLASSIFIED',
] as const;
export const movementPatternValues = [
  'HORIZONTAL_PUSH',
  'VERTICAL_PUSH',
  'HORIZONTAL_PULL',
  'VERTICAL_PULL',
  'ROW',
  'SQUAT_KNEE_DOMINANT',
  'LUNGE',
  'HIP_HINGE',
  'HIP_EXTENSION',
  'KNEE_EXTENSION',
  'KNEE_FLEXION',
  'ELBOW_FLEXION',
  'ELBOW_EXTENSION',
  'SHOULDER_ABDUCTION',
  'SHOULDER_HORIZONTAL_ABDUCTION',
  'CALF_PLANTAR_FLEXION',
  'TRUNK_FLEXION',
  'TRUNK_STABILIZATION',
  'CARDIO',
] as const;
export const fatigueTagValues = [
  'AXIAL_LOAD',
  'LUMBAR_ISOMETRIC',
  'SYSTEMIC_COMPOUND',
  'GRIP',
] as const;
export const jointStressValues = [
  'SHOULDER',
  'ELBOW',
  'WRIST',
  'LUMBAR_SPINE',
  'HIP',
  'KNEE',
  'ANKLE',
] as const;

export type ExerciseLoadConfidence = (typeof exerciseLoadConfidenceValues)[number];
export type ExerciseLoadProvenance = (typeof exerciseLoadProvenanceValues)[number];
export type MovementPattern = (typeof movementPatternValues)[number];
export type FatigueTag = (typeof fatigueTagValues)[number];
export type JointStressTag = (typeof jointStressValues)[number];

const confidenceSchema = z.enum(exerciseLoadConfidenceValues);
const provenanceSchema = z.enum(exerciseLoadProvenanceValues);
const dimensionStateSchema = z.enum(['KNOWN', 'UNKNOWN']);

const muscleEntrySchema = z
  .object({
    muscleGroup: z.nativeEnum(MuscleGroup),
    provenance: provenanceSchema,
    confidence: confidenceSchema,
  })
  .strict();

const taggedEntrySchema = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .object({
      value: z.enum(values),
      provenance: provenanceSchema,
      confidence: confidenceSchema,
    })
    .strict();

const dimensionSchema = <T extends z.ZodTypeAny>(entry: T, maximum: number) =>
  z
    .object({
      state: dimensionStateSchema,
      entries: z.array(entry).max(maximum),
    })
    .strict()
    .superRefine((dimension, ctx) => {
      if (dimension.state === 'UNKNOWN' && dimension.entries.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Unknown load-profile dimensions cannot contain classified entries.',
        });
      }
    });

export const exerciseLoadProfileSchema = z
  .object({
    version: z.literal(EXERCISE_LOAD_PROFILE_VERSION),
    algorithmVersion: z.literal(EXERCISE_LOAD_ALGORITHM_VERSION),
    classification: z.enum(exerciseLoadClassificationValues),
    provenance: provenanceSchema,
    confidence: confidenceSchema,
    primaryMuscles: dimensionSchema(muscleEntrySchema, 8),
    secondaryMuscles: dimensionSchema(muscleEntrySchema, 12),
    movementPatterns: dimensionSchema(taggedEntrySchema(movementPatternValues), 16),
    fatigueTags: dimensionSchema(taggedEntrySchema(fatigueTagValues), 12),
    jointStress: dimensionSchema(taggedEntrySchema(jointStressValues), 12),
  })
  .strict()
  .superRefine((profile, ctx) => {
    for (const [dimensionName, entries] of [
      ['primaryMuscles', profile.primaryMuscles.entries],
      ['secondaryMuscles', profile.secondaryMuscles.entries],
      ['movementPatterns', profile.movementPatterns.entries],
      ['fatigueTags', profile.fatigueTags.entries],
      ['jointStress', profile.jointStress.entries],
    ] as const) {
      const keys = entries.map((entry) =>
        'muscleGroup' in entry ? entry.muscleGroup : entry.value,
      );
      if (new Set(keys).size !== keys.length) {
        ctx.addIssue({
          code: 'custom',
          path: [dimensionName, 'entries'],
          message: 'Load-profile dimensions cannot contain duplicate entries.',
        });
      }
    }

    const primary = new Set(profile.primaryMuscles.entries.map((entry) => entry.muscleGroup));
    for (const entry of profile.secondaryMuscles.entries) {
      if (primary.has(entry.muscleGroup)) {
        ctx.addIssue({
          code: 'custom',
          path: ['secondaryMuscles', 'entries'],
          message: 'The same muscle cannot be both primary and secondary.',
        });
      }
    }
  });

export type ExerciseLoadProfile = z.infer<typeof exerciseLoadProfileSchema>;

type ReviewedProfileInput = {
  primaryMuscles: MuscleGroup[] | null;
  secondaryMuscles?: MuscleGroup[] | null;
  movementPatterns?: MovementPattern[] | null;
  fatigueTags?: FatigueTag[] | null;
  jointStress?: JointStressTag[] | null;
  confidence?: Exclude<ExerciseLoadConfidence, 'UNKNOWN'>;
};

function muscleDimension(
  values: MuscleGroup[] | null,
  provenance: ExerciseLoadProvenance,
  confidence: ExerciseLoadConfidence,
): ExerciseLoadProfile['primaryMuscles'] {
  return values == null
    ? { state: 'UNKNOWN', entries: [] }
    : {
        state: 'KNOWN',
        entries: values.map((muscleGroup) => ({ muscleGroup, provenance, confidence })),
      };
}

function tagDimension<T extends string>(
  values: T[] | null | undefined,
  provenance: ExerciseLoadProvenance,
  confidence: ExerciseLoadConfidence,
) {
  return values == null
    ? { state: 'UNKNOWN' as const, entries: [] }
    : {
        state: 'KNOWN' as const,
        entries: values.map((value) => ({ value, provenance, confidence })),
      };
}

export function reviewedExerciseLoadProfile(input: ReviewedProfileInput): ExerciseLoadProfile {
  const provenance = 'SYSTEM_CATALOG_REVIEW' as const;
  const confidence = input.confidence ?? 'MEDIUM';
  return {
    version: EXERCISE_LOAD_PROFILE_VERSION,
    algorithmVersion: EXERCISE_LOAD_ALGORITHM_VERSION,
    classification: 'REVIEWED',
    provenance,
    confidence,
    primaryMuscles: muscleDimension(input.primaryMuscles, provenance, confidence),
    secondaryMuscles: muscleDimension(input.secondaryMuscles ?? null, provenance, confidence),
    movementPatterns: tagDimension(input.movementPatterns, provenance, confidence),
    fatigueTags: tagDimension(input.fatigueTags, provenance, confidence),
    jointStress: tagDimension(input.jointStress, provenance, confidence),
  };
}

export function legacyPrimaryExerciseLoadProfile(muscleGroup: MuscleGroup): ExerciseLoadProfile {
  const provenance = 'LEGACY_PRIMARY_MIGRATION' as const;
  const hasKnownPrimary = muscleGroup !== MuscleGroup.OTHER;
  return {
    version: EXERCISE_LOAD_PROFILE_VERSION,
    algorithmVersion: EXERCISE_LOAD_ALGORITHM_VERSION,
    classification: 'LEGACY_PRIMARY_ONLY',
    provenance,
    confidence: hasKnownPrimary ? 'LOW' : 'UNKNOWN',
    primaryMuscles: muscleDimension(
      hasKnownPrimary ? [muscleGroup] : null,
      provenance,
      hasKnownPrimary ? 'LOW' : 'UNKNOWN',
    ),
    secondaryMuscles: { state: 'UNKNOWN', entries: [] },
    movementPatterns: { state: 'UNKNOWN', entries: [] },
    fatigueTags: { state: 'UNKNOWN', entries: [] },
    jointStress: { state: 'UNKNOWN', entries: [] },
  };
}

export function unclassifiedExerciseLoadProfile(): ExerciseLoadProfile {
  return {
    version: EXERCISE_LOAD_PROFILE_VERSION,
    algorithmVersion: EXERCISE_LOAD_ALGORITHM_VERSION,
    classification: 'UNCLASSIFIED',
    provenance: 'UNCLASSIFIED',
    confidence: 'UNKNOWN',
    primaryMuscles: { state: 'UNKNOWN', entries: [] },
    secondaryMuscles: { state: 'UNKNOWN', entries: [] },
    movementPatterns: { state: 'UNKNOWN', entries: [] },
    fatigueTags: { state: 'UNKNOWN', entries: [] },
    jointStress: { state: 'UNKNOWN', entries: [] },
  };
}

export function normalizeExerciseLoadProfile(
  value: unknown,
  legacyMuscleGroup: MuscleGroup,
): ExerciseLoadProfile {
  const parsed = exerciseLoadProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : legacyPrimaryExerciseLoadProfile(legacyMuscleGroup);
}
