import { z } from 'zod';
import { MuscleGroup } from '@/lib/prisma-client';

export const COACHING_PROFILE_VERSION = 1 as const;

export const coachingFieldStateSchema = z.enum(['UNKNOWN', 'KNOWN', 'NOT_APPLICABLE']);
export const coachingHealthStatusSchema = z.enum([
  'NO_SIGNIFICANT_ISSUES',
  'TRAIN_WITH_LIMITATIONS',
  'MEDICAL_CLEARANCE_REQUIRED',
]);
export const coachingTrainingLevelSchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export const coachingLimitationKindSchema = z.enum([
  'PAIN',
  'INJURY',
  'FORBIDDEN_MOVEMENT',
  'DISCOURAGED_MOVEMENT',
  'FORBIDDEN_EXERCISE',
  'DISCOURAGED_EXERCISE',
]);
export const coachingOutsideActivityTypeSchema = z.enum(['CARDIO', 'SPORT', 'PHYSICAL_WORK']);
export const coachingActivityIntensitySchema = z.enum(['LOW', 'MODERATE', 'HIGH']);

const isoTimestampSchema = z.string().datetime({ offset: true });

function uniqueTrimmedStrings(maxItems: number, maxLength: number) {
  return z
    .array(z.string().trim().min(1).max(maxLength))
    .min(1)
    .max(maxItems)
    .transform((values) => {
      const seen = new Set<string>();
      return values.filter((value) => {
        const key = value.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
}

export const coachingLimitationSchema = z.object({
  kind: coachingLimitationKindSchema,
  label: z.string().trim().min(1).max(120),
  affectedExerciseNames: uniqueTrimmedStrings(30, 120).refine(
    (names) => names.length > 0,
    'Add at least one affected exercise so the restriction can be enforced.',
  ),
  details: z.string().trim().max(500).nullable().optional(),
});

export const coachingLimitationsValueSchema = z
  .object({
    entries: z.array(coachingLimitationSchema).max(20),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => value.entries.length > 0, {
    message: 'Add at least one structured limitation or mark the field not applicable.',
    path: ['entries'],
  });

export const coachingOutsideActivitySchema = z.object({
  type: coachingOutsideActivityTypeSchema,
  name: z.string().trim().min(1).max(120),
  sessionsPerWeek: z.number().int().min(0).max(14).nullable().optional(),
  minutesPerWeek: z.number().int().min(0).max(3000).nullable().optional(),
  intensity: coachingActivityIntensitySchema.nullable().optional(),
  details: z.string().trim().max(500).nullable().optional(),
});

function statefulInputSchema<T extends z.ZodTypeAny>(
  valueSchema: T,
  options: { notApplicable?: boolean } = {},
) {
  const variants: [
    z.ZodObject<{ state: z.ZodLiteral<'UNKNOWN'>; value: z.ZodOptional<z.ZodNull> }>,
    z.ZodObject<{ state: z.ZodLiteral<'KNOWN'>; value: T }>,
    ...Array<
      z.ZodObject<{ state: z.ZodLiteral<'NOT_APPLICABLE'>; value: z.ZodOptional<z.ZodNull> }>
    >,
  ] = [
    z.object({ state: z.literal('UNKNOWN'), value: z.null().optional() }),
    z.object({ state: z.literal('KNOWN'), value: valueSchema }),
  ];
  if (options.notApplicable) {
    variants.push(z.object({ state: z.literal('NOT_APPLICABLE'), value: z.null().optional() }));
  }
  return z.discriminatedUnion('state', variants);
}

const healthStatusInputSchema = statefulInputSchema(coachingHealthStatusSchema);
const trainingLevelInputSchema = statefulInputSchema(coachingTrainingLevelSchema);
const availableWeekdaysInputSchema = statefulInputSchema(
  z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique.')
    .transform((days) => [...days].sort((a, b) => a - b)),
);
const limitationsInputSchema = statefulInputSchema(coachingLimitationsValueSchema, {
  notApplicable: true,
});
const maximumSessionDurationInputSchema = statefulInputSchema(z.number().int().min(20).max(240));
const priorityMusclesInputSchema = statefulInputSchema(
  z
    .array(z.nativeEnum(MuscleGroup))
    .min(1)
    .max(15)
    .refine((values) => new Set(values).size === values.length, 'Priority muscles must be unique.'),
  { notApplicable: true },
);
const priorityStrengthMovementsInputSchema = statefulInputSchema(uniqueTrimmedStrings(20, 120), {
  notApplicable: true,
});
const outsideActivitiesInputSchema = statefulInputSchema(
  z.array(coachingOutsideActivitySchema).min(1).max(20),
  { notApplicable: true },
);
const exerciseNamesInputSchema = statefulInputSchema(uniqueTrimmedStrings(50, 120), {
  notApplicable: true,
});
const averageSleepHoursInputSchema = statefulInputSchema(z.number().min(0).max(24), {
  notApplicable: true,
});
const oneToFiveInputSchema = statefulInputSchema(z.number().int().min(1).max(5), {
  notApplicable: true,
});

export const coachingProfilePatchSchema = z
  .object({
    healthStatus: healthStatusInputSchema.optional(),
    trainingLevel: trainingLevelInputSchema.optional(),
    availableWeekdays: availableWeekdaysInputSchema.optional(),
    limitations: limitationsInputSchema.optional(),
    maximumSessionDurationMin: maximumSessionDurationInputSchema.optional(),
    priorityMuscles: priorityMusclesInputSchema.optional(),
    priorityStrengthMovements: priorityStrengthMovementsInputSchema.optional(),
    outsideActivities: outsideActivitiesInputSchema.optional(),
    likedExercises: exerciseNamesInputSchema.optional(),
    dislikedExercises: exerciseNamesInputSchema.optional(),
    averageSleepHours: averageSleepHoursInputSchema.optional(),
    baselineStress: oneToFiveInputSchema.optional(),
    generalRecovery: oneToFiveInputSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Add at least one coaching-profile field.');

function storedFieldSchema<T extends z.ZodTypeAny>(inputSchema: T) {
  return inputSchema.and(z.object({ updatedAt: isoTimestampSchema.nullable() }));
}

export const coachingProfileSchema = z.object({
  version: z.literal(COACHING_PROFILE_VERSION),
  updatedAt: isoTimestampSchema.nullable(),
  healthStatus: storedFieldSchema(healthStatusInputSchema),
  trainingLevel: storedFieldSchema(trainingLevelInputSchema),
  availableWeekdays: storedFieldSchema(availableWeekdaysInputSchema),
  limitations: storedFieldSchema(limitationsInputSchema),
  maximumSessionDurationMin: storedFieldSchema(maximumSessionDurationInputSchema),
  priorityMuscles: storedFieldSchema(priorityMusclesInputSchema),
  priorityStrengthMovements: storedFieldSchema(priorityStrengthMovementsInputSchema),
  outsideActivities: storedFieldSchema(outsideActivitiesInputSchema),
  likedExercises: storedFieldSchema(exerciseNamesInputSchema),
  dislikedExercises: storedFieldSchema(exerciseNamesInputSchema),
  averageSleepHours: storedFieldSchema(averageSleepHoursInputSchema),
  baselineStress: storedFieldSchema(oneToFiveInputSchema),
  generalRecovery: storedFieldSchema(oneToFiveInputSchema),
});

export type CoachingFieldState = z.infer<typeof coachingFieldStateSchema>;
export type CoachingHealthStatus = z.infer<typeof coachingHealthStatusSchema>;
export type CoachingTrainingLevel = z.infer<typeof coachingTrainingLevelSchema>;
export type CoachingLimitation = z.infer<typeof coachingLimitationSchema>;
export type CoachingLimitationsValue = z.infer<typeof coachingLimitationsValueSchema>;
export type CoachingOutsideActivity = z.infer<typeof coachingOutsideActivitySchema>;
export type CoachingProfilePatch = z.infer<typeof coachingProfilePatchSchema>;
export type CoachingProfile = z.infer<typeof coachingProfileSchema>;

function unknownField() {
  return { state: 'UNKNOWN' as const, value: null, updatedAt: null };
}

export function emptyCoachingProfile(): CoachingProfile {
  return {
    version: COACHING_PROFILE_VERSION,
    updatedAt: null,
    healthStatus: unknownField(),
    trainingLevel: unknownField(),
    availableWeekdays: unknownField(),
    limitations: unknownField(),
    maximumSessionDurationMin: unknownField(),
    priorityMuscles: unknownField(),
    priorityStrengthMovements: unknownField(),
    outsideActivities: unknownField(),
    likedExercises: unknownField(),
    dislikedExercises: unknownField(),
    averageSleepHours: unknownField(),
    baselineStress: unknownField(),
    generalRecovery: unknownField(),
  };
}

export function normalizeCoachingProfile(
  value: unknown,
  fallbackUpdatedAt?: Date | string | null,
): CoachingProfile {
  const parsed = coachingProfileSchema.safeParse(value);
  if (!parsed.success) return emptyCoachingProfile();
  if (parsed.data.updatedAt || !fallbackUpdatedAt) return parsed.data;
  const updatedAt =
    fallbackUpdatedAt instanceof Date ? fallbackUpdatedAt.toISOString() : fallbackUpdatedAt;
  return { ...parsed.data, updatedAt };
}

export function applyCoachingProfilePatch(
  currentValue: unknown,
  patch: CoachingProfilePatch,
  now = new Date(),
): CoachingProfile {
  const current = normalizeCoachingProfile(currentValue);
  const updatedAt = now.toISOString();
  const stamp = (
    field: { state: CoachingFieldState; value?: unknown } | undefined,
    previous: unknown,
  ) =>
    field
      ? {
          ...field,
          value: field.state === 'KNOWN' ? field.value : null,
          updatedAt,
        }
      : previous;
  return coachingProfileSchema.parse({
    ...current,
    updatedAt,
    healthStatus: stamp(patch.healthStatus, current.healthStatus),
    trainingLevel: stamp(patch.trainingLevel, current.trainingLevel),
    availableWeekdays: stamp(patch.availableWeekdays, current.availableWeekdays),
    limitations: stamp(patch.limitations, current.limitations),
    maximumSessionDurationMin: stamp(
      patch.maximumSessionDurationMin,
      current.maximumSessionDurationMin,
    ),
    priorityMuscles: stamp(patch.priorityMuscles, current.priorityMuscles),
    priorityStrengthMovements: stamp(
      patch.priorityStrengthMovements,
      current.priorityStrengthMovements,
    ),
    outsideActivities: stamp(patch.outsideActivities, current.outsideActivities),
    likedExercises: stamp(patch.likedExercises, current.likedExercises),
    dislikedExercises: stamp(patch.dislikedExercises, current.dislikedExercises),
    averageSleepHours: stamp(patch.averageSleepHours, current.averageSleepHours),
    baselineStress: stamp(patch.baselineStress, current.baselineStress),
    generalRecovery: stamp(patch.generalRecovery, current.generalRecovery),
  });
}

export function knownCoachingValue<T>(field: {
  state: CoachingFieldState;
  value?: T | null;
}): T | null {
  return field.state === 'KNOWN' ? (field.value ?? null) : null;
}

export function hasKnownLimitations(profile: CoachingProfile): boolean {
  return (
    profile.limitations.state === 'NOT_APPLICABLE' ||
    (profile.limitations.state === 'KNOWN' && profile.limitations.value.entries.length > 0)
  );
}

export function summarizeCoachingLimitations(profile: CoachingProfile): string | null {
  if (profile.limitations.state === 'NOT_APPLICABLE') return 'none';
  if (profile.limitations.state !== 'KNOWN') return null;
  const entries = profile.limitations.value.entries.map((entry) => {
    const exercises = entry.affectedExerciseNames.join(', ');
    return `${entry.kind}: ${entry.label} (exclude: ${exercises})${entry.details ? ` - ${entry.details}` : ''}`;
  });
  if (profile.limitations.value.note) entries.push(profile.limitations.value.note);
  return entries.join('; ');
}
