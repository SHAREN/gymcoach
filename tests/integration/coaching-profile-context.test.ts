import { describe, expect, it } from 'vitest';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { buildCoachPayload } from '@/lib/coach';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';

describe('structured coaching profile context', () => {
  it('preserves explicit field states in the compact context used by MCP', async () => {
    const profile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        limitations: { state: 'NOT_APPLICABLE' },
        availableWeekdays: { state: 'UNKNOWN' },
      },
      new Date('2026-09-05T13:00:00.000Z'),
    );
    const user = await db.user.create({
      data: {
        email: 'coaching-context@test.dev',
        passwordHash: 'x',
        coachingProfile: profile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(profile.updatedAt!),
      },
    });

    const context = await buildCoachPayload(user.id);

    expect(context.userProfile.coachingProfile).toMatchObject({
      version: 1,
      healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
      limitations: { state: 'NOT_APPLICABLE', value: null },
      availableWeekdays: { state: 'UNKNOWN', value: null },
    });
  });
});
