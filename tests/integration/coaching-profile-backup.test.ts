import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getBackup, POST as postBackup } from '@/app/api/backup/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function restoreRequest(payload: unknown): Request {
  return new Request('http://test.local/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, confirmReplace: true }),
  });
}

beforeEach(() => mockUserId.mockReset());

describe('structured coaching profile backup', () => {
  it('round-trips explicit field states and timestamps', async () => {
    const profile = applyCoachingProfilePatch(
      null,
      {
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        limitations: { state: 'NOT_APPLICABLE' },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
      },
      new Date('2026-09-05T12:00:00.000Z'),
    );
    const source = await db.user.create({
      data: {
        email: 'coaching-backup-source@test.dev',
        passwordHash: 'x',
        coachNote: 'Keep this note too',
        coachingProfile: profile as Prisma.InputJsonValue,
        coachingProfileUpdatedAt: new Date(profile.updatedAt!),
      },
    });
    actAs(source.id);

    const exportResponse = await getBackup();
    expect(exportResponse.status).toBe(200);
    const dump = await exportResponse.json();
    expect(dump.version).toBe(6);
    expect(dump.profile).toMatchObject({
      coachNote: 'Keep this note too',
      coachingProfile: {
        version: 1,
        updatedAt: '2026-09-05T12:00:00.000Z',
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        limitations: { state: 'NOT_APPLICABLE', value: null },
        availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
      },
    });

    const target = await db.user.create({
      data: { email: 'coaching-backup-target@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const restoreResponse = await postBackup(restoreRequest(dump));
    expect(restoreResponse.status).toBe(200);

    const restored = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(restored.coachNote).toBe('Keep this note too');
    expect(restored.coachingProfileUpdatedAt?.toISOString()).toBe('2026-09-05T12:00:00.000Z');
    expect(restored.coachingProfile).toMatchObject({
      healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
      limitations: { state: 'NOT_APPLICABLE', value: null },
      availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
    });
  });
});
