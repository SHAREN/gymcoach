import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import { requireMobileUserId, requireOwnedWorkout } from '@/lib/mobile-programs-catalog';
import { programExerciseInputSchema } from '@/lib/schemas/program-exercise';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedWorkout(id, userId);
    const data = await parseJsonBody(req, programExerciseInputSchema);
    const exercise = await db.exercise.findUnique({ where: { id: data.exerciseId } });
    if (!exercise || exercise.userId !== userId) {
      return Response.json({ error: 'Invalid exercise.' }, { status: 400 });
    }
    const last = await db.programExercise.findFirst({
      where: { workoutId: id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const defaults = defaultIntraSetConfig(exercise);
    const created = await db.programExercise.create({
      data: {
        workoutId: id,
        exerciseId: data.exerciseId,
        order: (last?.order ?? 0) + 1,
        targetSets: data.targetSets,
        targetDropSets: data.targetDropSets ?? 0,
        targetRepsMin: data.targetRepsMin,
        targetRepsMax: data.targetRepsMax,
        targetRIR: data.targetRIR,
        restSec: data.restSec,
        autoregulationMode: data.autoregulationMode ?? 'PRESERVE_RIR',
        fatigueRate: data.fatigueRate ?? defaults.fatigueRate,
        loadAdjustmentPct: data.loadAdjustmentPct ?? defaults.loadAdjustmentPct,
        tempo: data.tempo ?? null,
        notes: data.notes ?? null,
        supersetGroup: data.supersetGroup ?? null,
      },
      include: { exercise: true },
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
