import { authenticateMobileRequest } from '@/lib/mobile-auth';
import { clearMobileVolumeTarget, saveMobileVolumeTarget } from '@/lib/mobile-progress-actions';
import { volumeTargetClearSchema, volumeTargetInputSchema } from '@/lib/schemas/volume-target';

export async function POST(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = volumeTargetInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid volume target.' }, { status: 400 });
  }
  return Response.json(await saveMobileVolumeTarget(principal.userId, parsed.data), {
    status: 201,
  });
}

export async function DELETE(req: Request) {
  const principal = await authenticateMobileRequest(req);
  if (!principal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = volumeTargetClearSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid volume target.' }, { status: 400 });
  }
  await clearMobileVolumeTarget(principal.userId, parsed.data);
  return Response.json({ muscleGroup: parsed.data.muscleGroup, cleared: true });
}
