import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { buildMobileCoachOverview } from '@/lib/mobile-coach';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return Response.json(await buildMobileCoachOverview(principal.userId));
  } catch (error) {
    console.error('[mobile/coach/overview] failed:', error);
    return Response.json({ error: 'Server error.' }, { status: 500 });
  }
}
