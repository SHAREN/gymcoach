import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { buildMobileHistory } from '@/lib/mobile-history';
import { mobileHistoryQuerySchema } from '@/lib/schemas/mobile-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const parsed = mobileHistoryQuerySchema.safeParse({
    month: url.searchParams.get('month'),
    programId: url.searchParams.get('programId') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: 'Invalid history filter.' }, { status: 400 });
  }

  try {
    return Response.json(
      await buildMobileHistory(principal.userId, parsed.data.month, parsed.data.programId),
    );
  } catch (error) {
    console.error('[mobile/history] failed:', error);
    return Response.json({ error: 'Server error.' }, { status: 500 });
  }
}
