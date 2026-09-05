import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET as getProfile, PATCH as patchProfile } from '@/app/api/profile/route';

function jsonReq(body: unknown): Request {
  return new Request('http://test.local/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('profile route - structured coaching profile', () => {
  it('normalizes a legacy null profile to explicit UNKNOWN states', async () => {
    const user = await db.user.create({
      data: { email: `coaching-legacy-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await getProfile();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coachingProfile).toMatchObject({
      version: 1,
      updatedAt: null,
      healthStatus: { state: 'UNKNOWN', value: null, updatedAt: null },
      limitations: { state: 'UNKNOWN', value: null, updatedAt: null },
    });
  });

  it('merges partial patches without erasing previously saved fields', async () => {
    const user = await db.user.create({
      data: { email: `coaching-merge-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    mockUserId.mockResolvedValue(user.id);

    const first = await patchProfile(
      jsonReq({
        coachingProfile: {
          healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
          limitations: {
            state: 'KNOWN',
            value: {
              entries: [
                {
                  kind: 'PAIN',
                  label: 'Pressing discomfort',
                  affectedExerciseNames: ['Bench press'],
                },
              ],
            },
          },
        },
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const firstTimestamp = firstBody.coachingProfile.healthStatus.updatedAt as string;

    const second = await patchProfile(
      jsonReq({
        coachingProfile: {
          availableWeekdays: { state: 'KNOWN', value: [5, 1, 3] },
        },
      }),
    );
    expect(second.status).toBe(200);
    const body = await second.json();

    expect(body.coachingProfile.healthStatus).toMatchObject({
      state: 'KNOWN',
      value: 'TRAIN_WITH_LIMITATIONS',
      updatedAt: firstTimestamp,
    });
    expect(body.coachingProfile.limitations.value.entries[0]).toMatchObject({
      kind: 'PAIN',
      affectedExerciseNames: ['Bench press'],
    });
    expect(body.coachingProfile.availableWeekdays).toMatchObject({
      state: 'KNOWN',
      value: [1, 3, 5],
    });
  });

  it('keeps UNKNOWN distinct from explicit NOT_APPLICABLE', async () => {
    const user = await db.user.create({
      data: { email: `coaching-state-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await patchProfile(
      jsonReq({
        coachingProfile: {
          limitations: { state: 'NOT_APPLICABLE' },
          outsideActivities: { state: 'UNKNOWN' },
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.coachingProfile.limitations).toMatchObject({
      state: 'NOT_APPLICABLE',
      value: null,
    });
    expect(body.coachingProfile.outsideActivities).toMatchObject({
      state: 'UNKNOWN',
      value: null,
    });
  });
});
