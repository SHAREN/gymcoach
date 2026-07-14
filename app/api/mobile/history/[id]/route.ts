import { db } from '@/lib/db';
import { authenticateMobileRequest } from '@/lib/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: Request, props: Params) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await props.params;
  const session = await db.session.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!session || session.userId !== principal.userId) {
    return Response.json({ error: 'Session not found.' }, { status: 404 });
  }

  await db.session.delete({ where: { id } });
  return Response.json({ ok: true });
}
