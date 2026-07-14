import { describe, expect, it } from 'vitest';
import { GET as history } from '@/app/api/mobile/history/route';
import { DELETE as deleteHistory } from '@/app/api/mobile/history/[id]/route';
import { db } from '@/lib/db';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';

async function authorize(userId: string, deviceId: string): Promise<string> {
  const token = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId,
      deviceId,
      deviceName: 'History test phone',
      tokenHash: hashMobileToken(token),
      tokenPrefix: visibleMobileTokenPrefix(token),
      expiresAt: mobileTokenExpiry(),
    },
  });
  return token;
}

describe('mobile history', () => {
  it('returns the filtered month with server-derived strength and cardio details', async () => {
    const user = await db.user.create({
      data: {
        email: 'mobile-history@test.dev',
        passwordHash: 'x',
        bodyweight: 70,
        unit: 'KG',
      },
    });
    const program = await db.program.create({
      data: { userId: user.id, name: 'Upper Lower', phase: 'Build', isActive: true },
    });
    const workout = await db.workout.create({
      data: { programId: program.id, name: 'Upper', order: 0 },
    });
    const [pullup, run] = await Promise.all([
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Pull-up',
          muscleGroup: 'BACK_WIDTH',
          category: 'COMPOUND',
          usesBodyweight: true,
        },
      }),
      db.exercise.create({
        data: {
          userId: user.id,
          name: 'Running',
          muscleGroup: 'OTHER',
          category: 'CARDIO',
          equipmentType: 'CARDIO',
        },
      }),
    ]);
    const session = await db.session.create({
      data: {
        userId: user.id,
        programId: program.id,
        workoutId: workout.id,
        startedAt: new Date('2026-07-10T10:00:00.000Z'),
        finishedAt: new Date('2026-07-10T11:00:00.000Z'),
        notes: 'Felt strong',
        sessionRpe: 7,
        sets: {
          create: [
            {
              exerciseId: pullup.id,
              setNumber: 1,
              weight: 0,
              reps: 5,
              isWarmup: true,
              completedAt: new Date('2026-07-10T10:05:00.000Z'),
            },
            {
              exerciseId: pullup.id,
              setNumber: 2,
              weight: 10,
              reps: 6,
              rir: 2,
              recoverySec: 150,
              notes: 'Clean reps',
              completedAt: new Date('2026-07-10T10:10:00.000Z'),
            },
            {
              exerciseId: run.id,
              setNumber: 1,
              weight: 0,
              reps: 1,
              durationSec: 1_800,
              distanceM: 5_000,
              avgHr: 145,
              maxHr: 172,
              completedAt: new Date('2026-07-10T10:30:00.000Z'),
            },
          ],
        },
      },
    });
    await db.session.create({
      data: {
        userId: user.id,
        programId: program.id,
        startedAt: new Date('2026-06-10T10:00:00.000Z'),
        finishedAt: new Date('2026-06-10T11:00:00.000Z'),
      },
    });
    const token = await authorize(user.id, 'history-device');

    const response = await history(
      new Request(`http://test.local/api/mobile/history?month=2026-07&programId=${program.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: 1,
      month: '2026-07',
      selectedProgramId: program.id,
      unit: 'KG',
      hasAnyHistory: true,
      programs: [{ id: program.id, name: 'Upper Lower' }],
    });
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      id: session.id,
      workoutName: 'Upper',
      programName: 'Upper Lower',
      durationMin: 60,
      notes: 'Felt strong',
      sessionRpe: 7,
      workingSets: 2,
      volume: 480,
    });
    expect(body.sessions[0].exercises[0]).toMatchObject({
      name: 'Pull-up',
      volume: 480,
      estimated1RM: 96,
    });
    expect(body.sessions[0].exercises[0].sets[1]).toMatchObject({
      weight: 10,
      effectiveWeight: 80,
      reps: 6,
      rir: 2,
      recoverySec: 150,
      notes: 'Clean reps',
    });
    expect(body.sessions[0].exercises[1]).toMatchObject({
      name: 'Running',
      cardio: { durationSec: 1_800, distanceM: 5_000, avgHr: 145 },
    });
  });

  it('validates filters and enforces ownership when deleting', async () => {
    const [owner, stranger] = await Promise.all([
      db.user.create({
        data: { email: 'mobile-history-owner@test.dev', passwordHash: 'x' },
      }),
      db.user.create({
        data: { email: 'mobile-history-stranger@test.dev', passwordHash: 'x' },
      }),
    ]);
    const session = await db.session.create({
      data: {
        userId: owner.id,
        startedAt: new Date('2026-07-11T10:00:00.000Z'),
        finishedAt: new Date('2026-07-11T11:00:00.000Z'),
      },
    });
    const ownerToken = await authorize(owner.id, 'history-owner-device');
    const strangerToken = await authorize(stranger.id, 'history-stranger-device');

    const invalid = await history(
      new Request('http://test.local/api/mobile/history?month=July', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
    );
    expect(invalid.status).toBe(400);

    const forbidden = await deleteHistory(
      new Request(`http://test.local/api/mobile/history/${session.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${strangerToken}` },
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(forbidden.status).toBe(404);

    const deleted = await deleteHistory(
      new Request(`http://test.local/api/mobile/history/${session.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
      { params: Promise.resolve({ id: session.id }) },
    );
    expect(deleted.status).toBe(200);
    expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();
  });
});
