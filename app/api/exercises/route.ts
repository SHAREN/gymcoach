import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exerciseInputSchema } from '@/lib/schemas/exercise';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { defaultExerciseLoadProfile } from '@/lib/exercise-load-catalog';

export async function GET() {
  try {
    const userId = await requireApiUserId();
    const exercises = await db.exercise.findMany({
      where: { userId },
      orderBy: [{ muscleGroup: 'asc' }, { name: 'asc' }],
    });
    return NextResponse.json(exercises);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const data = await parseJsonBody(req, exerciseInputSchema);
    const exercise = await db.exercise.create({
      data: {
        ...data,
        userId,
        notes: data.notes ?? null,
        loadProfile:
          data.loadProfile ??
          defaultExerciseLoadProfile(data.name, data.muscleGroup, data.category),
      },
    });
    return NextResponse.json(exercise, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
