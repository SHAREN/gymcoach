import { describe, expect, it } from 'vitest';
import { GET as progress } from '@/app/api/mobile/progress/route';
import { db } from '@/lib/db';
import {
  generateMobileToken,
  hashMobileToken,
  mobileTokenExpiry,
  visibleMobileTokenPrefix,
} from '@/lib/mobile-auth';
import { isoWeekKey, isoWeekStart } from '@/lib/stats';

async function authorize(userId: string): Promise<string> {
  const rawToken = generateMobileToken();
  await db.mobileAccessToken.create({
    data: {
      userId,
      deviceId: 'progress-test-device',
      deviceName: 'Progress integration phone',
      tokenHash: hashMobileToken(rawToken),
      tokenPrefix: visibleMobileTokenPrefix(rawToken),
      expiresAt: mobileTokenExpiry(),
    },
  });
  return rawToken;
}

describe('GET /api/mobile/progress', () => {
  it('requires a valid mobile bearer token', async () => {
    const response = await progress(new Request('http://test.local/api/mobile/progress'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('matches the web exercise selector and full-history point semantics', async () => {
    const owner = await db.user.create({
      data: {
        email: 'mobile-progress@test.dev',
        passwordHash: 'x',
        bodyweight: 70,
        weeklyFrequency: 2,
      },
    });
    const stranger = await db.user.create({
      data: { email: 'mobile-progress-stranger@test.dev', passwordHash: 'x' },
    });
    const [bench, pullup, oldOnly, warmupOnly, cardio, strangerBench, strangerCardio] =
      await Promise.all([
        db.exercise.create({
          data: {
            userId: owner.id,
            name: 'Bench Press',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
            equipmentType: 'BARBELL',
          },
        }),
        db.exercise.create({
          data: {
            userId: owner.id,
            name: 'Pull-up',
            muscleGroup: 'BACK_WIDTH',
            category: 'COMPOUND',
            equipmentType: 'BODYWEIGHT',
            usesBodyweight: true,
          },
        }),
        db.exercise.create({
          data: {
            userId: owner.id,
            name: 'Old Only Lift',
            muscleGroup: 'OTHER',
            category: 'ISOLATION',
          },
        }),
        db.exercise.create({
          data: {
            userId: owner.id,
            name: 'Warmup Only Lift',
            muscleGroup: 'OTHER',
            category: 'ISOLATION',
          },
        }),
        db.exercise.create({
          data: {
            userId: owner.id,
            name: 'Running',
            muscleGroup: 'OTHER',
            category: 'CARDIO',
            equipmentType: 'CARDIO',
          },
        }),
        db.exercise.create({
          data: {
            userId: stranger.id,
            name: 'Stranger Bench',
            muscleGroup: 'CHEST',
            category: 'COMPOUND',
          },
        }),
        db.exercise.create({
          data: {
            userId: stranger.id,
            name: 'Stranger Running',
            muscleGroup: 'OTHER',
            category: 'CARDIO',
            equipmentType: 'CARDIO',
          },
        }),
      ]);

    const oldStartedAt = new Date('2020-01-01T10:00:00.000Z');
    await db.session.create({
      data: {
        userId: owner.id,
        startedAt: oldStartedAt,
        finishedAt: new Date('2020-01-01T11:00:00.000Z'),
        sets: {
          create: [
            {
              exerciseId: bench.id,
              setNumber: 1,
              weight: 50,
              reps: 10,
              completedAt: new Date('2020-01-01T10:10:00.000Z'),
            },
            {
              exerciseId: oldOnly.id,
              setNumber: 1,
              weight: 100,
              reps: 5,
              completedAt: new Date('2020-01-01T10:20:00.000Z'),
            },
          ],
        },
      },
    });

    const currentWeekStart = isoWeekStart(new Date());
    const finishedStartedAt = new Date(currentWeekStart);
    finishedStartedAt.setUTCHours(10, 0, 0, 0);
    await db.session.create({
      data: {
        userId: owner.id,
        startedAt: finishedStartedAt,
        finishedAt: new Date(finishedStartedAt.getTime() + 3_600_000),
        sets: {
          create: { exerciseId: bench.id, setNumber: 1, weight: 60, reps: 10 },
        },
      },
    });

    const recentStartedAt = new Date(currentWeekStart);
    recentStartedAt.setUTCDate(recentStartedAt.getUTCDate() + 1);
    recentStartedAt.setUTCHours(10, 0, 0, 0);
    await db.session.create({
      data: {
        userId: owner.id,
        startedAt: recentStartedAt,
        // The web progress page includes a current session once it has logged
        // sets, so intentionally leave finishedAt null here.
        sets: {
          create: [
            { exerciseId: bench.id, setNumber: 1, weight: 20, reps: 5, isWarmup: true },
            { exerciseId: bench.id, setNumber: 2, weight: 80, reps: 5 },
            { exerciseId: bench.id, setNumber: 3, weight: 80, reps: 6 },
            { exerciseId: pullup.id, setNumber: 1, weight: 10, reps: 6 },
            { exerciseId: pullup.id, setNumber: 2, weight: 5, reps: 10 },
            {
              exerciseId: cardio.id,
              setNumber: 1,
              weight: 0,
              reps: 1,
              durationSec: 1_800,
              distanceM: 5_000,
            },
            {
              exerciseId: cardio.id,
              setNumber: 2,
              weight: 0,
              reps: 1,
              durationSec: 600,
              distanceM: 1_000,
              isWarmup: true,
            },
            {
              exerciseId: warmupOnly.id,
              setNumber: 1,
              weight: 10,
              reps: 10,
              isWarmup: true,
            },
          ],
        },
      },
    });

    await db.session.create({
      data: {
        userId: stranger.id,
        startedAt: recentStartedAt,
        finishedAt: new Date(recentStartedAt.getTime() + 3_600_000),
        sets: {
          create: [
            { exerciseId: strangerBench.id, setNumber: 1, weight: 200, reps: 5 },
            {
              exerciseId: strangerCardio.id,
              setNumber: 1,
              weight: 0,
              reps: 1,
              durationSec: 3_600,
              distanceM: 12_000,
            },
          ],
        },
      },
    });

    const [olderBodyweight, newerBodyweight] = await Promise.all([
      db.bodyweightEntry.create({
        data: {
          userId: owner.id,
          weightKg: 70.5,
          measuredAt: new Date(currentWeekStart.getTime() + 8 * 3_600_000),
        },
      }),
      db.bodyweightEntry.create({
        data: {
          userId: owner.id,
          weightKg: 71,
          measuredAt: new Date(currentWeekStart.getTime() + 32 * 3_600_000),
        },
      }),
    ]);
    await Promise.all([
      db.bodyweightEntry.create({
        data: {
          userId: owner.id,
          weightKg: 65,
          measuredAt: new Date('2020-01-01T08:00:00.000Z'),
        },
      }),
      db.bodyweightEntry.create({
        data: {
          userId: stranger.id,
          weightKg: 120,
          measuredAt: new Date(currentWeekStart.getTime() + 40 * 3_600_000),
        },
      }),
    ]);

    const [olderMeasurement, newerMeasurement] = await Promise.all([
      db.bodyMeasurement.create({
        data: {
          userId: owner.id,
          site: 'WAIST',
          valueCm: 82,
          measuredAt: new Date(currentWeekStart.getTime() + 9 * 3_600_000),
        },
      }),
      db.bodyMeasurement.create({
        data: {
          userId: owner.id,
          site: 'CHEST',
          valueCm: 103,
          measuredAt: new Date(currentWeekStart.getTime() + 33 * 3_600_000),
        },
      }),
    ]);
    await Promise.all([
      db.bodyMeasurement.create({
        data: {
          userId: owner.id,
          site: 'HIPS',
          valueCm: 90,
          measuredAt: new Date('2020-01-01T08:00:00.000Z'),
        },
      }),
      db.bodyMeasurement.create({
        data: {
          userId: stranger.id,
          site: 'WAIST',
          valueCm: 150,
          measuredAt: new Date(currentWeekStart.getTime() + 41 * 3_600_000),
        },
      }),
    ]);

    const token = await authorize(owner.id);
    const response = await progress(
      new Request('http://test.local/api/mobile/progress', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schemaVersion).toBe(4);
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    expect(body.exercises.map((exercise: { name: string }) => exercise.name)).toEqual([
      'Bench Press',
      'Pull-up',
    ]);

    const selectedOldResponse = await progress(
      new Request(`http://test.local/api/mobile/progress?exerciseId=${oldOnly.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(selectedOldResponse.status).toBe(200);
    const selectedOldBody = await selectedOldResponse.json();
    expect(selectedOldBody.exercises.map((exercise: { name: string }) => exercise.name)).toEqual([
      'Bench Press',
      'Old Only Lift',
      'Pull-up',
    ]);
    expect(
      selectedOldBody.exercises.find((exercise: { id: string }) => exercise.id === oldOnly.id)
        .points,
    ).toEqual([
      expect.objectContaining({
        sessionStartedAt: oldStartedAt.toISOString(),
        maxWeight: 100,
      }),
    ]);

    const foreignSelectedResponse = await progress(
      new Request(`http://test.local/api/mobile/progress?exerciseId=${strangerBench.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(foreignSelectedResponse.status).toBe(200);
    expect(
      (await foreignSelectedResponse.json()).exercises.map(
        (exercise: { name: string }) => exercise.name,
      ),
    ).toEqual(['Bench Press', 'Pull-up']);

    const invalidSelectedResponse = await progress(
      new Request('http://test.local/api/mobile/progress?exerciseId=%20%20', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(invalidSelectedResponse.status).toBe(400);
    expect(body.exercises[0]).toMatchObject({
      id: bench.id,
      name: 'Bench Press',
      muscleGroup: 'CHEST',
      usesBodyweight: false,
      points: [
        {
          sessionStartedAt: oldStartedAt.toISOString(),
          maxWeight: 50,
          estimated1RM: 66.7,
          totalVolume: 500,
          topSetReps: 10,
          maxReps: 10,
          totalReps: 10,
        },
        {
          sessionStartedAt: finishedStartedAt.toISOString(),
          maxWeight: 60,
          estimated1RM: 80,
          totalVolume: 600,
          topSetReps: 10,
          maxReps: 10,
          totalReps: 10,
        },
        {
          sessionStartedAt: recentStartedAt.toISOString(),
          maxWeight: 80,
          estimated1RM: 96,
          totalVolume: 880,
          topSetReps: 6,
          maxReps: 6,
          totalReps: 11,
        },
      ],
    });
    expect(body.exercises[1]).toMatchObject({
      id: pullup.id,
      name: 'Pull-up',
      muscleGroup: 'BACK_WIDTH',
      usesBodyweight: true,
      points: [
        {
          sessionStartedAt: recentStartedAt.toISOString(),
          maxWeight: 80,
          estimated1RM: 96,
          totalVolume: 1230,
          topSetReps: 6,
          maxReps: 10,
          totalReps: 16,
        },
      ],
    });

    expect(body.weeklyVolume).toEqual([
      {
        weekKey: isoWeekKey(currentWeekStart),
        weekStartIso: currentWeekStart.toISOString(),
        byMuscleGroup: { CHEST: 1_480, BACK_WIDTH: 1_230 },
        total: 2_710,
      },
    ]);
    expect(body.consistency.weeks).toHaveLength(12);
    expect(body.consistency).toMatchObject({ currentStreak: 0, weeklyFrequency: 2 });
    expect(body.consistency.weeks.at(-1)).toEqual({
      weekKey: isoWeekKey(currentWeekStart),
      weekStartIso: currentWeekStart.toISOString(),
      trainedDays: 1,
      onStreak: false,
      isCurrent: true,
    });
    expect(body.bodyweightEntries).toEqual([
      {
        id: newerBodyweight.id,
        weightKg: 71,
        measuredAt: newerBodyweight.measuredAt.toISOString(),
      },
      {
        id: olderBodyweight.id,
        weightKg: 70.5,
        measuredAt: olderBodyweight.measuredAt.toISOString(),
      },
    ]);
    expect(body.bodyMeasurements).toEqual([
      {
        id: newerMeasurement.id,
        site: 'CHEST',
        valueCm: 103,
        measuredAt: newerMeasurement.measuredAt.toISOString(),
      },
      {
        id: olderMeasurement.id,
        site: 'WAIST',
        valueCm: 82,
        measuredAt: olderMeasurement.measuredAt.toISOString(),
      },
    ]);
    expect(body.conditioningWeeks).toHaveLength(8);
    expect(body.conditioningWeeks.slice(0, -1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ minutes: 0, distanceKm: 0, sessions: 0 })]),
    );
    expect(body.conditioningWeeks.at(-1)).toEqual({
      weekKey: isoWeekKey(currentWeekStart),
      weekStartIso: currentWeekStart.toISOString(),
      minutes: 30,
      distanceKm: 5,
      sessions: 1,
    });
    expect(body.unit).toBe('KG');
    expect(body.exercises[0].bestEstimated1RM).toBe(96);
    expect(body.exercises[0].loadingTable).toHaveLength(8);
    expect(body.exercises[0].recap).toMatchObject({
      sessions: 2,
      firstWeight: 60,
      lastWeight: 80,
      weightDelta: 20,
      stalled: false,
    });
    expect(body.records.map((record: { exerciseName: string }) => record.exerciseName)).toEqual([
      'Bench Press',
      'Old Only Lift',
      'Pull-up',
    ]);
    expect(body.deload).toMatchObject({ active: false, recommended: false });
  });

  it('returns null conditioning when the user has never logged cardio', async () => {
    const user = await db.user.create({
      data: { email: 'mobile-progress-no-cardio@test.dev', passwordHash: 'x' },
    });
    const token = await authorize(user.id);

    const response = await progress(
      new Request('http://test.local/api/mobile/progress', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conditioningWeeks).toBeNull();
    expect(body.weeklyVolume).toEqual([]);
    expect(body.consistency.weeks).toHaveLength(12);
  });
});
