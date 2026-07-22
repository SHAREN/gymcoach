import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { authenticateMobileRequestDetailed } from '@/lib/mobile-auth';
import { mobileAuthErrorCode } from '@/lib/mobile-settings-contract';
import { setRequestAuthDiagnostic } from '@/lib/request-auth-diagnostics';
import {
  mobileCreateMetadataSchema,
  type MobileCreateMetadata,
} from '@/lib/schemas/mobile-idempotency';

export async function requireMobileUserId(req: Request): Promise<string> {
  try {
    const result = await authenticateMobileRequestDetailed(req);
    if (result.principal) {
      setRequestAuthDiagnostic(req, { outcome: 'valid', scheme: 'bearer' });
      return result.principal.userId;
    }
    setRequestAuthDiagnostic(req, {
      outcome: result.outcome,
      scheme: result.outcome === 'missing' ? 'none' : 'bearer',
    });
    throw new ApiError(401, 'Unauthorized', mobileAuthErrorCode(result.outcome), result.outcome);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      setRequestAuthDiagnostic(req, { outcome: 'unavailable', scheme: 'bearer' });
    }
    throw error;
  }
}

export function parseMobileCreateMetadata(req: Request): MobileCreateMetadata {
  const parsed = mobileCreateMetadataSchema.safeParse({
    operationId: req.headers.get('Idempotency-Key') ?? undefined,
    clientEntityId: req.headers.get('X-Client-Entity-Id') ?? undefined,
  });
  if (!parsed.success)
    throw new ApiError(400, parsed.error.issues[0]?.message ?? 'Invalid metadata.');
  return parsed.data;
}

export async function requireOwnedProgram(programId: string, userId: string) {
  const program = await db.program.findUnique({ where: { id: programId } });
  if (!program || program.userId !== userId) throw new ApiError(404, 'Program not found.');
  return program;
}

export async function requireOwnedWorkout(workoutId: string, userId: string) {
  const workout = await db.workout.findUnique({
    where: { id: workoutId },
    include: { program: { select: { userId: true } } },
  });
  if (!workout || workout.program.userId !== userId) {
    throw new ApiError(404, 'Workout not found.');
  }
  return workout;
}

export async function requireOwnedProgramExercise(programExerciseId: string, userId: string) {
  const programExercise = await db.programExercise.findUnique({
    where: { id: programExerciseId },
    include: { workout: { include: { program: { select: { userId: true } } } } },
  });
  if (!programExercise || programExercise.workout.program.userId !== userId) {
    throw new ApiError(404, 'Program exercise not found.');
  }
  return programExercise;
}

export async function requireOwnedExercise(exerciseId: string, userId: string) {
  const exercise = await db.exercise.findUnique({ where: { id: exerciseId } });
  if (!exercise || exercise.userId !== userId) throw new ApiError(404, 'Exercise not found.');
  return exercise;
}

export async function readMobileProgram(programId: string, userId: string) {
  await requireOwnedProgram(programId, userId);
  return db.program.findUnique({
    where: { id: programId },
    include: {
      workouts: {
        orderBy: { order: 'asc' },
        include: {
          exercises: {
            orderBy: { order: 'asc' },
            include: { exercise: true },
          },
        },
      },
    },
  });
}
