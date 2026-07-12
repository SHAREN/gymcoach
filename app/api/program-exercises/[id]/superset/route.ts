import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { smallestFreeGroup } from '@/lib/supersets';

interface Params {
  params: Promise<{ id: string }>;
}

const supersetActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), neighborId: z.string().min(1) }),
  z.object({ action: z.literal('dissolve') }),
]);

// Mutates every member involved in one transaction. This avoids leaving a
// half-created superset when one of several ordinary PUT requests fails.
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, supersetActionSchema);

    const exercises = await db.$transaction(async (tx) => {
      const current = await tx.programExercise.findFirst({
        where: { id: params.id, workout: { program: { userId } } },
      });
      if (!current) throw new ApiError(404, 'Program exercise not found.');

      const workoutExercises = await tx.programExercise.findMany({
        where: { workoutId: current.workoutId },
        orderBy: { order: 'asc' },
      });

      if (input.action === 'dissolve') {
        if (current.supersetGroup != null) {
          await tx.programExercise.updateMany({
            where: { workoutId: current.workoutId, supersetGroup: current.supersetGroup },
            data: { supersetGroup: null },
          });
        }
      } else {
        if (input.neighborId === current.id) {
          throw new ApiError(400, 'An exercise cannot be linked to itself.');
        }
        const neighbor = workoutExercises.find((item) => item.id === input.neighborId);
        if (!neighbor) throw new ApiError(404, 'Neighboring exercise not found.');

        const currentGroup = current.supersetGroup;
        const neighborGroup = neighbor.supersetGroup;

        if (currentGroup == null && neighborGroup == null) {
          const freeGroup = smallestFreeGroup(workoutExercises);
          if (freeGroup == null) throw new ApiError(409, 'Superset limit reached.');
          await tx.programExercise.updateMany({
            where: { id: { in: [current.id, neighbor.id] } },
            data: { supersetGroup: freeGroup },
          });
        } else if (currentGroup == null) {
          await tx.programExercise.update({
            where: { id: current.id },
            data: { supersetGroup: neighborGroup },
          });
        } else if (neighborGroup == null) {
          await tx.programExercise.update({
            where: { id: neighbor.id },
            data: { supersetGroup: currentGroup },
          });
        } else if (currentGroup !== neighborGroup) {
          // Joining neighboring supersets merges the current group into the
          // neighbor's group, preserving all existing members atomically.
          await tx.programExercise.updateMany({
            where: { workoutId: current.workoutId, supersetGroup: currentGroup },
            data: { supersetGroup: neighborGroup },
          });
        }
      }

      return tx.programExercise.findMany({
        where: { workoutId: current.workoutId },
        orderBy: { order: 'asc' },
        include: { exercise: true },
      });
    });

    return NextResponse.json({ exercises });
  } catch (error) {
    return handleApiError(error);
  }
}
