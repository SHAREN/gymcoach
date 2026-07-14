import { describe, expect, it } from 'vitest';
import { GET as overview } from '@/app/api/mobile/coach/overview/route';
import { GET as conversations } from '@/app/api/coach/chat/route';
import { PATCH as updateProfile } from '@/app/api/profile/route';
import { db } from '@/lib/db';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';

async function authorize(userId: string): Promise<string> {
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId,
      deviceId: 'coach-test-device',
      deviceName: 'Coach integration phone',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  return token;
}

function bearerRequest(url: string, token: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

describe('native coach API', () => {
  it('requires mobile authentication for the native overview', async () => {
    const response = await overview(new Request('http://test.local/api/mobile/coach/overview'));
    expect(response.status).toBe(401);
  });

  it('returns the owner-scoped coach overview and accepts bearer profile updates', async () => {
    const owner = await db.user.create({
      data: { email: 'mobile-coach@test.dev', passwordHash: 'x', coachNote: 'Original note' },
    });
    const stranger = await db.user.create({
      data: { email: 'mobile-coach-stranger@test.dev', passwordHash: 'x' },
    });
    await db.coachSession.create({
      data: {
        userId: owner.id,
        weekStart: new Date('2026-07-13T00:00:00Z'),
        weekEnd: new Date('2026-07-20T00:00:00Z'),
        prompt: 'prompt',
        response: '# Review',
      },
    });
    await db.conversation.createMany({
      data: [
        { userId: owner.id, title: 'Owner conversation' },
        { userId: stranger.id, title: 'Foreign conversation' },
      ],
    });
    const token = await authorize(owner.id);

    const response = await overview(
      bearerRequest('http://test.local/api/mobile/coach/overview', token),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coachNote).toBe('Original note');
    expect(body.history).toHaveLength(1);
    expect(body.conversations.map((item: { title: string }) => item.title)).toEqual([
      'Owner conversation',
    ]);

    const update = await updateProfile(
      bearerRequest('http://test.local/api/profile', token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachNote: 'Updated from Android' }),
      }),
    );
    expect(update.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).coachNote).toBe(
      'Updated from Android',
    );

    const list = await conversations(
      bearerRequest('http://test.local/api/coach/chat', token),
    );
    expect(list.status).toBe(200);
    expect((await list.json()).map((item: { title: string }) => item.title)).toEqual([
      'Owner conversation',
    ]);
  });
});
