import { describe, expect, it } from 'vitest';
import { POST as saveGoal } from '@/app/api/mobile/progress/goals/route';
import { DELETE as deleteGoal } from '@/app/api/mobile/progress/goals/[id]/route';
import {
  DELETE as clearVolumeTarget,
  POST as saveVolumeTarget,
} from '@/app/api/mobile/progress/volume-targets/route';
import { DELETE as endDeload, POST as startDeload } from '@/app/api/mobile/progress/deload/route';
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
      deviceId: `progress-actions-${userId}`,
      deviceName: 'Progress actions phone',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  return token;
}

function jsonRequest(url: string, token: string, method: 'POST' | 'DELETE', body: unknown) {
  return new Request(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('mobile progress actions', () => {
  it('manages goals, volume targets, and planned deload for the token owner', async () => {
    const user = await db.user.create({
      data: { email: 'mobile-progress-actions@test.dev', passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const token = await authorize(user.id);

    const goalResponse = await saveGoal(
      jsonRequest('http://test.local/api/mobile/progress/goals', token, 'POST', {
        exerciseId: exercise.id,
        targetWeight: 100,
        targetReps: 5,
      }),
    );
    expect(goalResponse.status).toBe(201);
    const goal = await goalResponse.json();
    expect(goal).toMatchObject({ exerciseId: exercise.id, targetWeight: 100, targetReps: 5 });

    const targetResponse = await saveVolumeTarget(
      jsonRequest('http://test.local/api/mobile/progress/volume-targets', token, 'POST', {
        muscleGroup: 'CHEST',
        mev: 8,
        mrv: 16,
      }),
    );
    expect(targetResponse.status).toBe(201);
    expect(await targetResponse.json()).toEqual({ muscleGroup: 'CHEST', mev: 8, mrv: 16 });

    const deloadResponse = await startDeload(
      jsonRequest('http://test.local/api/mobile/progress/deload', token, 'POST', {}),
    );
    expect(deloadResponse.status).toBe(201);
    expect((await db.user.findUnique({ where: { id: user.id } }))?.deloadUntil).not.toBeNull();

    expect(
      (
        await deleteGoal(
          new Request(`http://test.local/api/mobile/progress/goals/${goal.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
          { params: Promise.resolve({ id: goal.id }) },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await clearVolumeTarget(
          jsonRequest('http://test.local/api/mobile/progress/volume-targets', token, 'DELETE', {
            muscleGroup: 'CHEST',
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await endDeload(
          new Request('http://test.local/api/mobile/progress/deload', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(200);
    expect(await db.exerciseGoal.findUnique({ where: { id: goal.id } })).toBeNull();
    expect(await db.volumeTarget.findMany({ where: { userId: user.id } })).toEqual([]);
    expect((await db.user.findUnique({ where: { id: user.id } }))?.deloadUntil).toBeNull();
  });

  it('rejects invalid target bands', async () => {
    const user = await db.user.create({
      data: { email: 'mobile-progress-invalid-target@test.dev', passwordHash: 'x' },
    });
    const token = await authorize(user.id);
    const response = await saveVolumeTarget(
      jsonRequest('http://test.local/api/mobile/progress/volume-targets', token, 'POST', {
        muscleGroup: 'CHEST',
        mev: 20,
        mrv: 10,
      }),
    );
    expect(response.status).toBe(400);
  });
});
