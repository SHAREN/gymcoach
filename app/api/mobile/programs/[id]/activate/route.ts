import { handleApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMobileUserId, requireOwnedProgram } from '@/lib/mobile-programs-catalog';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedProgram(id, userId);
    const body = (await req.json().catch(() => ({}))) as { active?: boolean };
    const active = body.active !== false;
    if (active) {
      await db.$transaction([
        db.program.updateMany({
          where: { userId, isActive: true, id: { not: id } },
          data: { isActive: false },
        }),
        db.program.update({ where: { id }, data: { isActive: true } }),
      ]);
    } else {
      await db.program.update({ where: { id }, data: { isActive: false } });
    }
    return Response.json(await db.program.findUnique({ where: { id } }));
  } catch (error) {
    return handleApiError(error);
  }
}
