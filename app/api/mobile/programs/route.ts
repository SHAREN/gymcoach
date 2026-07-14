import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import { parseMobileCreateMetadata, requireMobileUserId } from '@/lib/mobile-programs-catalog';
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
    const metadata = parseMobileCreateMetadata(req);
    const data = await parseJsonBody(req, programInputSchema);
    if (metadata.clientEntityId) {
      const existing = await db.program.findUnique({ where: { id: metadata.clientEntityId } });
      if (existing) {
        if (existing.userId !== userId) {
          return Response.json({ error: 'Client entity id is already in use.' }, { status: 409 });
        }
        return Response.json(existing);
      }
    }
    const program = await db.program.create({
      data: {
        id: metadata.clientEntityId,
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
