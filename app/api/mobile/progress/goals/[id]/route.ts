import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { deleteMobileGoal } from '@/lib/mobile-progress-actions';

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: Request, props: Params) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;
  if (!(await deleteMobileGoal(principal.userId, id))) {
    return Response.json({ error: 'Goal not found.' }, { status: 404 });
  }
  return Response.json({ ok: true });
}
