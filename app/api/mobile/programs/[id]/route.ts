import { handleApiError, parseJsonBody } from '@/lib/api';
import { db } from '@/lib/db';
import {
  readMobileProgram,
  requireMobileUserId,
  requireOwnedProgram,
} from '@/lib/mobile-programs-catalog';
import { programInputSchema } from '@/lib/schemas/program';

interface Params {
  params: Promise<{ id: string }>;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    return Response.json(await readMobileProgram(id, userId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, props: Params) {
  try {
    const { id } = await props.params;
    const userId = await requireMobileUserId(req);
    await requireOwnedProgram(id, userId);
    const data = await parseJsonBody(req, programInputSchema);
    return Response.json(
      await db.program.update({
        where: { id },
        data: { name: data.name, phase: data.phase, description: data.description ?? null },
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
    await requireOwnedProgram(id, userId);
    await db.program.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
