import type { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { readinessCheckinInputSchema } from '@/lib/schemas/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = readinessCheckinInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid readiness check-in.' },
      { status: 400 },
    );
  }

  try {
    const created = await db.readinessCheckin.create({
      data: {
        userId: principal.userId,
        readiness: parsed.data.readiness,
        sleepQuality: parsed.data.sleepQuality,
        soreness: (parsed.data.soreness ?? undefined) as Prisma.InputJsonValue | undefined,
        note: parsed.data.note ?? null,
      },
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error('[mobile/readiness] failed:', error);
    return Response.json({ error: 'Server error.' }, { status: 500 });
  }
}
