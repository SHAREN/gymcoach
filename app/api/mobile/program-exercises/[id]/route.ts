import { ApiError, handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId, requireOwnedProgramExercise } from '@/lib/mobile-programs-catalog';
import { programExerciseInputSchema } from '@/lib/schemas/program-exercise';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedProgramExercise(id, userId);
    const data = await parseJsonBody(req, programExerciseInputSchema);
    const exercise = await db.exercise.findUnique({ where: { id: data.exerciseId } });
    if (!exercise || exercise.userId !== userId) throw new ApiError(400, 'Invalid exercise.');
    return Response.json(
      await db.programExercise.update({
        where: { id },
        data: {
          exerciseId: data.exerciseId,
          targetSets: data.targetSets,
          targetDropSets: data.targetDropSets,
          targetRepsMin: data.targetRepsMin,
          targetRepsMax: data.targetRepsMax,
          targetRIR: data.targetRIR,
          restSec: data.restSec,
          autoregulationMode: data.autoregulationMode ?? undefined,
          fatigueRate: data.fatigueRate,
          loadAdjustmentPct: data.loadAdjustmentPct,
          tempo: data.tempo ?? null,
          notes: data.notes ?? null,
          supersetGroup: data.supersetGroup,
        },
        include: { exercise: true },
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedProgramExercise(id, userId);
    await db.programExercise.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
