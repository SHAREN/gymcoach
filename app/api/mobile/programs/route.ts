import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId } from '@/lib/mobile-programs-catalog';
import { programInputSchema } from '@/lib/schemas/program';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const userId = await requireMobileUserId(req);
    return Response.json(
      await db.program.findMany({
        where: { userId },
        orderBy: [{ isActive: 'desc' }, { startDate: 'desc' }],
        include: { _count: { select: { workouts: true, sessions: true } } },
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireMobileUserId(req);
    const data = await parseJsonBody(req, programInputSchema);
    const program = await db.program.create({
      data: {
        userId,
        name: data.name,
        phase: data.phase,
        description: data.description ?? null,
      },
    });
    return Response.json(program, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
