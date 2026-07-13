import { db } from '@/lib/db';
import { authenticateMobileRequest } from '@/lib/mobile-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await db.mobileAccessToken.update({
    where: { id: principal.tokenId },
    data: { revokedAt: new Date() },
  });
  return Response.json({ ok: true });
}
