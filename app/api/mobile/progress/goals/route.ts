import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { saveMobileGoal } from '@/lib/mobile-progress-actions';
import { goalInputSchema } from '@/lib/schemas/goal';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = goalInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid goal.' }, { status: 400 });

  const goal = await saveMobileGoal(principal.userId, parsed.data);
  if (!goal) return Response.json({ error: 'Exercise not found.' }, { status: 404 });
  return Response.json(goal, { status: 201 });
}
