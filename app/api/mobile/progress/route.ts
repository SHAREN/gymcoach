import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { buildMobileProgress } from '@/lib/mobile-progress';
import { databaseIdSchema } from '@/lib/schemas/database-id';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const progressQuerySchema = z.object({
  exerciseId: databaseIdSchema.optional(),
});

export async function GET(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedQuery = progressQuerySchema.safeParse({
    exerciseId: new URL(req.url).searchParams.get('exerciseId') ?? undefined,
  });
  if (!parsedQuery.success) {
    return Response.json({ error: 'Invalid query.' }, { status: 400 });
  }

  try {
    return Response.json(
      await buildMobileProgress(principal.userId, new Date(), parsedQuery.data.exerciseId),
    );
  } catch (error) {
    console.error('[mobile/progress] failed:', error);
    return Response.json({ error: 'Server error.' }, { status: 500 });
  }
}
