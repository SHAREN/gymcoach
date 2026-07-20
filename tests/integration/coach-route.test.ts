import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';
import { Prisma } from '@/lib/prisma-client';
import { createCoachAuditPrompt } from '@/lib/coach-audit';

const completeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/lib/llm', () => {
  class MockLlmError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    LlmError: MockLlmError,
    getLlmProvider: () => ({ complete: completeMock }),
  };
});

const mockUserId = vi.mocked(getCurrentUserId);

import { POST as postCoach } from '@/app/api/coach/route';

beforeEach(() => {
  mockUserId.mockReset();
  completeMock.mockReset();
  completeMock.mockResolvedValue({ text: '# Weekly review', modelUsed: 'demo' });
});

describe('POST /api/coach audit persistence', () => {
  it('sends the structured profile to the provider without persisting it in the audit prompt', async () => {
    const coachingProfile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'NO_SIGNIFICANT_ISSUES' },
        averageSleepHours: { state: 'KNOWN', value: 7.25 },
        baselineStress: { state: 'KNOWN', value: 4 },
      },
      new Date('2026-07-20T09:00:00.000Z'),
    );
    const user = await db.user.create({
      data: {
        email: 'coach-audit@test.dev',
        passwordHash: 'x',
        coachingProfile: coachingProfile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(coachingProfile.updatedAt!),
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await postCoach(
      new Request('http://test.local/api/coach', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    const completionRequest = completeMock.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const providerPayload = JSON.parse(completionRequest.messages[0]!.content) as {
      userProfile: {
        coachingProfile: {
          averageSleepHours: { state: string; value: number | null };
          baselineStress: { state: string; value: number | null };
        };
      };
    };
    expect(providerPayload.userProfile.coachingProfile.averageSleepHours).toMatchObject({
      state: 'KNOWN',
      value: 7.25,
    });
    expect(providerPayload.userProfile.coachingProfile.baselineStress).toMatchObject({
      state: 'KNOWN',
      value: 4,
    });

    const stored = await db.coachSession.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.prompt).toBe(createCoachAuditPrompt('generated'));
    expect(stored.prompt).not.toContain('coachingProfile');
    expect(stored.prompt).not.toContain('averageSleepHours');
    expect(stored.prompt).not.toContain('baselineStress');
  });
});
