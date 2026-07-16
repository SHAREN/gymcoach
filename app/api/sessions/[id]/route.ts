import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionUpdateSchema } from '@/lib/schemas/session';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';

interface Params {
  params: Promise<{ id: string }>;
}

async function ensureOwnership(id: string, userId: string) {
  const session = await db.session.findUnique({ where: { id } });
  if (!session || session.userId !== userId) {
    throw new ApiError(404, 'Session not found.');
  }
  return session;
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await ensureOwnership(params.id, userId);
    const session = await db.session.findUnique({
      where: { id: params.id },
      include: {
        workout: {
          include: {
            exercises: {
              orderBy: { order: 'asc' },
              include: { exercise: true },
            },
          },
        },
        program: true,
        sets: { orderBy: [{ exerciseId: 'asc' }, { completedAt: 'asc' }, { id: 'asc' }] },
      },
    });
    return NextResponse.json(session);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    const session = await ensureOwnership(params.id, userId);
    const data = await parseJsonBody(req, sessionUpdateSchema);

    const updated = await db.$transaction(async (tx) => {
      if (data.finish && data.discardSetIds?.length) {
        await tx.set.deleteMany({
          where: {
            sessionId: params.id,
            id: { in: data.discardSetIds },
          },
        });
      }

      return tx.session.update({
        where: { id: params.id },
        data: {
          notes: data.notes ?? session.notes,
          finishedAt: data.finish ? new Date() : session.finishedAt,
          ...(data.sessionRpe !== undefined ? { sessionRpe: data.sessionRpe } : {}),
        },
      });
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const userId = await requireApiUserId();
    await ensureOwnership(params.id, userId);
    await db.session.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
