import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, signSession } from '@/lib/auth';
import { authenticateMobileRequest } from '@/lib/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const user = await db.user.findUnique({
    where: { id: principal.userId },
    select: { email: true },
  });
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const token = await signSession({ userId: principal.userId, email: user.email });
  (await cookies()).set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return Response.json({ ok: true });
}
