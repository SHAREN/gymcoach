import bcrypt from 'bcrypt';
import { z } from 'zod';
import { db } from '@/lib/db';
import { clientIp, rateLimit } from '@/lib/rate-limit';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';
import { mobileLoginSchema } from '@/lib/schemas/mobile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const limited = rateLimit(`mobile-login:${clientIp(req)}`, 10, 60_000);
  if (!limited.ok) {
    return Response.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  let input: z.infer<typeof mobileLoginSchema>;
  try {
    input = mobileLoginSchema.parse(await req.json());
  } catch {
    return Response.json({ error: 'Invalid email or password.' }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    return Response.json({ error: 'Invalid credentials.' }, { status: 401 });
  }

  const rawToken = generateMobileToken();
  const expiresAt = mobileTokenExpiry();
  const token = await db.$transaction(async (tx) => {
    await tx.mobileAccessToken.updateMany({
      where: { userId: user.id, deviceId: input.deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return tx.mobileAccessToken.create({
      data: {
        userId: user.id,
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        tokenHash: hashMobileToken(rawToken),
        tokenPrefix: visibleMobileTokenPrefix(rawToken),
        expiresAt,
      },
      select: { id: true, deviceId: true, deviceName: true, expiresAt: true },
    });
  });

  return Response.json({
    accessToken: rawToken,
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  });
}
