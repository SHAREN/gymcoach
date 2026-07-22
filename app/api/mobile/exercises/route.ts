import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { parseMobileCreateMetadata, requireMobileUserId } from '@/lib/mobile-programs-catalog';
import { withMobileSettingsDiagnostics } from '@/lib/mobile-settings-diagnostics';
import { exerciseInputSchema } from '@/lib/schemas/exercise';
import { clientExerciseClassificationMetadata } from '@/lib/exercise-classification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getExercises(req: Request) {
  try {
    const userId = await requireMobileUserId(req);
    const [exercises, exerciseSessions] = await Promise.all([
      db.exercise.findMany({
        where: { userId },
        orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
      }),
      db.set.findMany({
        where: {
          session: {
            userId,
            finishedAt: { not: null },
          },
        },
        distinct: ['exerciseId', 'sessionId'],
        select: {
          exerciseId: true,
          session: { select: { startedAt: true } },
        },
      }),
    ]);
    const trainingDatesByExercise = new Map<string, string[]>();
    for (const item of exerciseSessions) {
      const dates = trainingDatesByExercise.get(item.exerciseId) ?? [];
      dates.push(item.session.startedAt.toISOString());
      trainingDatesByExercise.set(item.exerciseId, dates);
    }
    return Response.json(
      exercises.map((exercise) => ({
        ...exercise,
        trainingDates: trainingDatesByExercise.get(exercise.id) ?? [],
      })),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

async function postExercise(req: Request) {
  try {
    const userId = await requireMobileUserId(req);
    const metadata = parseMobileCreateMetadata(req);
    const data = await parseJsonBody(req, exerciseInputSchema);
    if (metadata.clientEntityId) {
      const existing = await db.exercise.findUnique({ where: { id: metadata.clientEntityId } });
      if (existing) {
        if (existing.userId !== userId) {
          return Response.json({ error: 'Client entity id is already in use.' }, { status: 409 });
        }
        return Response.json(existing);
      }
    }
    const exercise = await db.exercise.create({
      data: {
        ...data,
        id: metadata.clientEntityId,
        userId,
        notes: data.notes ?? null,
        ...clientExerciseClassificationMetadata(),
      },
    });
    return Response.json(exercise, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const GET = withMobileSettingsDiagnostics('exercises', getExercises);
export const POST = withMobileSettingsDiagnostics('exercises', postExercise);
