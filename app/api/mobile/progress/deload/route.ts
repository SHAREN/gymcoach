import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { endMobileDeload, startMobileDeload } from '@/lib/mobile-progress-actions';
import { deloadStartSchema } from '@/lib/schemas/deload';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = deloadStartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const deloadUntil = await startMobileDeload(principal.userId);
  return Response.json({ deloadUntil: deloadUntil.toISOString() }, { status: 201 });
}

export async function DELETE(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await endMobileDeload(principal.userId);
  return Response.json({ deloadUntil: null });
}
