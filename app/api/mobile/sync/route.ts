import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { applyMobileOperations } from '@/lib/mobile-sync';
import { mobileSyncBatchSchema } from '@/lib/schemas/mobile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = mobileSyncBatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid data.' },
      { status: 400 },
    );
  }
  try {
    const results = await applyMobileOperations(principal, parsed.data.operations);
    return Response.json({ serverTime: new Date(), results });
  } catch (error) {
    console.error('[mobile/sync] infrastructure failure:', error);
    return Response.json({ error: 'Synchronization is temporarily unavailable.' }, { status: 503 });
  }
}
