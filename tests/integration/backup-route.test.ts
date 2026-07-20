import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';
import { Prisma } from '@/lib/prisma-client';
import { createCoachAuditPrompt } from '@/lib/coach-audit';

// Backup export/restore completeness (issue #168): the export must carry every
// user-owned model/field, the restore must be a lossless, ownership-scoped
// round trip, version 1 files must keep importing, and a malformed or
// oversized file must be rejected without partially written data.

// Auth is read through getCurrentUserId (via requireApiUserId in @/lib/api).
vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);
const EQUIPMENT_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EQUIPMENT_PNG_BASE64 = 'iVBORw0KGgo=';

import { GET as getBackup, POST as postBackup } from '@/app/api/backup/route';

function actAs(userId: string) {
  mockUserId.mockResolvedValue(userId);
}

function jsonReq(body: unknown): Request {
  return new Request('http://test.local/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(): Request {
  return new Request('http://test.local/api/backup');
}

// Order-insensitive deep normalization: sorts every array (the export order of
// sets depends on regenerated cuids) and every object key, so two dumps can be
// compared field-for-field.
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) {
    return v.map(sortDeep).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .map(([k, val]) => [k, sortDeep(val)] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    );
  }
  return v;
}

// Strips the fields that legitimately differ between two accounts/exports.
function comparable(dump: Record<string, unknown>): unknown {
  const { exportedAt: _exportedAt, user: _user, ...rest } = dump;
  return sortDeep(rest);
}

// Seeds a user with at least one row in every exported model, exercising all
// the fields issue #168 found missing.
async function seedFullUser(email: string) {
  const coachingProfile = applyCoachingProfilePatch(
    null,
    {
      healthStatus: { state: 'KNOWN', value: 'NO_SIGNIFICANT_ISSUES' },
      trainingLevel: { state: 'KNOWN', value: 'ADVANCED' },
      availableWeekdays: { state: 'KNOWN', value: [1, 3, 5, 6] },
      limitations: { state: 'NOT_APPLICABLE' },
      maximumSessionDurationMin: { state: 'KNOWN', value: 90 },
      outsideActivities: {
        state: 'KNOWN',
        value: [{ type: 'CARDIO', name: 'Cycling', minutesPerWeek: 120 }],
      },
      averageSleepHours: { state: 'KNOWN', value: 7.5 },
      baselineStress: { state: 'KNOWN', value: 3 },
      generalRecovery: { state: 'KNOWN', value: 4 },
    },
    new Date('2026-07-18T10:00:00.000Z'),
  );
  const user = await db.user.create({
    data: {
      email,
      passwordHash: 'x',
      displayName: 'Julien',
      bodyweight: 82.5,
      sex: 'MALE',
      heightCm: 181,
      goal: 'HYPERTROPHY',
      weeklyFrequency: 4,
      coachNote: 'Synthetic backup fixture note',
      coachingProfile: coachingProfile as Prisma.InputJsonValue,
      coachingProfileUpdatedAt: new Date(coachingProfile.updatedAt!),
      unit: 'LB',
      deloadUntil: new Date('2026-07-05T00:00:00.000Z'),
    },
  });
  const bench = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Bench Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
    },
  });
  const pullup = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Pull-up',
      muscleGroup: 'BACK_WIDTH',
      category: 'COMPOUND',
      usesBodyweight: true,
      equipmentType: 'BODYWEIGHT',
    },
  });
  const running = await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Running',
      muscleGroup: 'OTHER',
      category: 'CARDIO',
      equipmentType: 'CARDIO',
    },
  });
  const gym = await db.gym.create({
    data: {
      userId: user.id,
      name: 'Basement',
      inventoryMode: 'EQUIPMENT_FIRST',
      dumbbellWeights: [10, 12, 14, 16, 19],
      plateWeights: [1.25, 2.5, 5, 10, 20],
      barWeights: [20],
      exerciseConfigs: {
        create: [
          {
            exerciseId: running.id,
            isAvailable: false,
            weightOptions: [],
            dumbbellWeights: [7.5],
            plateWeights: [1.25],
            barWeights: [10],
          },
          {
            exerciseId: bench.id,
            isAvailable: true,
            systemProfileSupported: true,
          },
        ],
      },
    },
  });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  const platePool = await db.gymPlatePool.create({
    data: {
      gymId: gym.id,
      name: 'Olympic plates',
      compatibilityKey: 'olympic_50mm',
      systemBarbellFamily: 'LARGE',
      plates: {
        createMany: {
          data: [
            { weightKg: 20, quantity: 4 },
            { weightKg: 5, quantity: null },
          ],
        },
      },
    },
  });
  await db.gymPlatePool.create({
    data: {
      gymId: gym.id,
      name: 'Small diameter plates',
      compatibilityKey: 'system_barbell_small',
      systemBarbellFamily: 'SMALL',
    },
  });
  const equipment = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: 'Competition bench station',
      equipmentType: 'BARBELL',
      description: 'Flat bench with uprights and safety arms.',
      manufacturer: 'GymCo',
      modelName: 'Bench Pro',
      quantity: 2,
      loadType: 'PLATE_LOADED',
      baseLoadKg: 20,
      platePoolId: platePool.id,
      loadingSides: 2,
      systemBarbellFamily: 'LARGE',
      imageData: EQUIPMENT_PNG,
      imageMimeType: 'image/png',
      exerciseLinks: { create: { exerciseId: bench.id } },
    },
  });
  const program = await db.program.create({
    data: {
      userId: user.id,
      name: 'Block 1',
      phase: 'accumulation',
      isActive: true,
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      workouts: {
        create: [
          {
            name: 'Upper A',
            dayOfWeek: 1,
            order: 1,
            exercises: {
              create: [
                {
                  exerciseId: bench.id,
                  order: 1,
                  targetSets: 3,
                  targetDropSets: 1,
                  targetRepsMin: 5,
                  targetRepsMax: 8,
                  targetRIR: 2,
                  restSec: 120,
                  supersetGroup: 1,
                },
                {
                  exerciseId: pullup.id,
                  order: 2,
                  targetSets: 3,
                  targetRepsMin: 6,
                  targetRepsMax: 10,
                  targetRIR: 2,
                  restSec: 120,
                  supersetGroup: 1,
                },
              ],
            },
          },
        ],
      },
    },
    include: { workouts: true },
  });
  await db.session.create({
    data: {
      userId: user.id,
      programId: program.id,
      workoutId: program.workouts[0]?.id ?? null,
      startedAt: new Date('2026-06-01T10:00:00.000Z'),
      finishedAt: new Date('2026-06-01T11:00:00.000Z'),
      notes: 'good session',
      sessionRpe: 8,
      gymId: gym.id,
      sets: {
        create: [
          {
            exerciseId: bench.id,
            setNumber: 1,
            weight: 100,
            reps: 5,
            rir: 2,
            isDropSet: true,
            recoverySec: 150,
            gymEquipmentId: equipment.id,
            equipmentNameSnapshot: equipment.name,
            selectedLoadKg: 100,
            selectedLoadMultiplierSnapshot: 1,
            nominalResistanceKg: null,
            equipmentLoadSnapshot: {
              version: 1,
              loadType: 'PLATE_LOADED',
              equipmentType: 'BARBELL',
              selectedLoadKg: 100,
              selectedLoadMultiplier: 1,
              nominalResistanceKg: null,
              baseLoadKg: 20,
              loadingSides: 2,
              platePool: {
                id: platePool.id,
                name: platePool.name,
                compatibilityKey: platePool.compatibilityKey,
              },
            },
            notes: 'top set',
            completedAt: new Date('2026-06-01T10:10:00.000Z'),
          },
          {
            exerciseId: running.id,
            setNumber: 1,
            weight: 0,
            reps: 1,
            durationSec: 1800,
            distanceM: 5000,
            avgHr: 152,
            maxHr: 181,
            completedAt: new Date('2026-06-01T10:50:00.000Z'),
          },
        ],
      },
    },
  });
  await db.coachSession.create({
    data: {
      userId: user.id,
      weekStart: new Date('2026-06-01T00:00:00.000Z'),
      weekEnd: new Date('2026-06-07T00:00:00.000Z'),
      prompt: 'week summary',
      response: 'keep going',
      createdAt: new Date('2026-06-07T18:00:00.000Z'),
    },
  });
  await db.exerciseGoal.create({
    data: {
      userId: user.id,
      exerciseId: bench.id,
      targetWeight: 120,
      targetReps: 5,
      createdAt: new Date('2026-05-15T09:00:00.000Z'),
      achievedAt: new Date('2026-06-01T10:10:00.000Z'),
    },
  });
  await db.bodyweightEntry.createMany({
    data: [
      {
        userId: user.id,
        weightKg: 83.1,
        measuredAt: new Date('2026-05-20T07:00:00.000Z'),
        note: 'morning',
      },
      { userId: user.id, weightKg: 82.5, measuredAt: new Date('2026-06-05T07:00:00.000Z') },
    ],
  });
  await db.readinessCheckin.create({
    data: {
      userId: user.id,
      readiness: 4,
      sleepQuality: 3,
      soreness: { QUADS: 4, CHEST: 2 },
      note: 'legs heavy',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
    },
  });
  await db.conversation.create({
    data: {
      userId: user.id,
      title: 'Plateau on bench',
      createdAt: new Date('2026-06-02T08:00:00.000Z'),
      updatedAt: new Date('2026-06-02T08:05:00.000Z'),
      messages: {
        create: [
          {
            role: 'USER',
            content: 'My bench is stuck.',
            createdAt: new Date('2026-06-02T08:00:00.000Z'),
          },
          {
            role: 'ASSISTANT',
            content: 'Try a back-off set.',
            createdAt: new Date('2026-06-02T08:05:00.000Z'),
          },
        ],
      },
    },
  });
  return user;
}

async function countsFor(userId: string) {
  return {
    exercises: await db.exercise.count({ where: { userId } }),
    programs: await db.program.count({ where: { userId } }),
    sessions: await db.session.count({ where: { userId } }),
    sessionExerciseMemberships: await db.sessionExercise.count({
      where: { session: { userId } },
    }),
    sets: await db.set.count({ where: { session: { userId } } }),
    coachSessions: await db.coachSession.count({ where: { userId } }),
    goals: await db.exerciseGoal.count({ where: { userId } }),
    bodyweightEntries: await db.bodyweightEntry.count({ where: { userId } }),
    readinessCheckins: await db.readinessCheckin.count({ where: { userId } }),
    conversations: await db.conversation.count({ where: { userId } }),
    messages: await db.message.count({ where: { conversation: { userId } } }),
    gyms: await db.gym.count({ where: { userId } }),
    gymConfigs: await db.gymExerciseConfig.count({ where: { gym: { userId } } }),
    gymEquipment: await db.gymEquipment.count({ where: { gym: { userId } } }),
    gymPlatePools: await db.gymPlatePool.count({ where: { gym: { userId } } }),
    gymPlateItems: await db.gymPlateInventoryItem.count({ where: { pool: { gym: { userId } } } }),
    gymEquipmentLinks: await db.gymEquipmentExercise.count({
      where: { equipment: { gym: { userId } } },
    }),
  };
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('GET /api/backup - export completeness (issue #168)', () => {
  it('exports version 13 with coaching profile, coach note, system profiles and earlier fields', async () => {
    const user = await seedFullUser('a@test.dev');
    actAs(user.id);

    const res = await getBackup(getReq());
    expect(res.status).toBe(200);
    const dump = await res.json();

    expect(dump.version).toBe(13);
    expect(dump.profile).toMatchObject({
      displayName: 'Julien',
      bodyweight: 82.5,
      sex: 'MALE',
      heightCm: 181,
      goal: 'HYPERTROPHY',
      weeklyFrequency: 4,
      coachNote: 'Synthetic backup fixture note',
      coachingProfile: {
        version: 1,
        updatedAt: '2026-07-18T10:00:00.000Z',
        healthStatus: { state: 'KNOWN', value: 'NO_SIGNIFICANT_ISSUES' },
        limitations: { state: 'NOT_APPLICABLE', value: null },
        outsideActivities: {
          state: 'KNOWN',
          value: [{ type: 'CARDIO', name: 'Cycling', minutesPerWeek: 120 }],
        },
      },
      unit: 'LB',
      deloadUntil: '2026-07-05T00:00:00.000Z',
      activeGymName: 'Basement',
    });

    const pullup = dump.exercises.find((e: { name: string }) => e.name === 'Pull-up');
    expect(pullup.usesBodyweight).toBe(true);
    expect(pullup.equipmentType).toBe('BODYWEIGHT');
    expect(dump.gyms).toHaveLength(1);
    const exportedGym = dump.gyms[0];
    expect(exportedGym).toMatchObject({
      name: 'Basement',
      inventoryMode: 'EQUIPMENT_FIRST',
      dumbbellWeights: [10, 12, 14, 16, 19],
      plateWeights: [1.25, 2.5, 5, 10, 20],
      barWeights: [20],
    });
    expect(exportedGym.platePools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Olympic plates',
          compatibilityKey: 'olympic_50mm',
          systemBarbellFamily: 'LARGE',
          plates: [
            { weightKg: 5, quantity: null },
            { weightKg: 20, quantity: 4 },
          ],
        }),
        expect.objectContaining({
          compatibilityKey: 'system_barbell_small',
          systemBarbellFamily: 'SMALL',
          plates: [],
        }),
      ]),
    );
    expect(exportedGym.equipment).toEqual([
      expect.objectContaining({
        name: 'Competition bench station',
        equipmentType: 'BARBELL',
        description: 'Flat bench with uprights and safety arms.',
        manufacturer: 'GymCo',
        modelName: 'Bench Pro',
        quantity: 2,
        loadType: 'PLATE_LOADED',
        baseLoadKg: 20,
        platePoolCompatibilityKey: 'olympic_50mm',
        loadingSides: 2,
        systemBarbellFamily: 'LARGE',
        imageMimeType: 'image/png',
        imageBase64: EQUIPMENT_PNG_BASE64,
        exerciseNames: ['Bench Press'],
      }),
    ]);
    expect(exportedGym.exerciseConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseName: 'Bench Press',
          systemProfileSupported: true,
        }),
        expect.objectContaining({
          exerciseName: 'Running',
          isAvailable: false,
          dumbbellWeights: [7.5],
          plateWeights: [1.25],
          barWeights: [10],
          systemProfileSupported: null,
        }),
      ]),
    );
    expect(dump.sessions[0]).toMatchObject({
      gymName: 'Basement',
      sessionRpe: 8,
      exerciseNames: ['Bench Press', 'Running'],
    });

    const sets = dump.sessions[0].sets as Array<Record<string, unknown>>;
    const strength = sets.find((s) => s.exerciseName === 'Bench Press');
    expect(strength).toMatchObject({
      recoverySec: 150,
      equipmentName: 'Competition bench station',
      selectedLoadKg: 100,
      selectedLoadMultiplier: 1,
      nominalResistanceKg: null,
      equipmentLoadSnapshot: expect.objectContaining({ loadType: 'PLATE_LOADED' }),
    });
    const cardio = sets.find((s) => s.exerciseName === 'Running');
    expect(cardio).toMatchObject({ durationSec: 1800, distanceM: 5000, avgHr: 152, maxHr: 181 });

    const peGroups = dump.programs[0].workouts[0].exercises.map(
      (pe: { supersetGroup: number | null }) => pe.supersetGroup,
    );
    expect(peGroups).toEqual([1, 1]);

    expect(dump.programs[0].workouts[0].exercises[0].targetDropSets).toBe(1);

    expect(dump.exerciseGoals).toEqual([
      {
        exerciseName: 'Bench Press',
        targetWeight: 120,
        targetReps: 5,
        createdAt: '2026-05-15T09:00:00.000Z',
        achievedAt: '2026-06-01T10:10:00.000Z',
      },
    ]);
    expect(dump.bodyweightEntries).toHaveLength(2);
    expect(dump.readinessCheckins).toEqual([
      {
        readiness: 4,
        sleepQuality: 3,
        soreness: { QUADS: 4, CHEST: 2 },
        note: 'legs heavy',
        createdAt: '2026-06-01T09:00:00.000Z',
      },
    ]);
    expect(dump.conversations).toHaveLength(1);
    expect(dump.conversations[0].messages).toHaveLength(2);
    expect(dump.coachSessions[0].prompt).toBe(createCoachAuditPrompt('legacy-redacted'));
    expect(JSON.stringify(dump.coachSessions)).not.toContain('coachingProfile');
  });
});

describe('POST /api/backup - restore round trip (issue #168)', () => {
  it('restores an export losslessly into a second user, ownership-scoped', async () => {
    const userA = await seedFullUser('a@test.dev');
    actAs(userA.id);
    const dumpA = await (await getBackup(getReq())).json();
    const countsA = await countsFor(userA.id);

    const userB = await db.user.create({
      data: { email: 'b@test.dev', passwordHash: 'x' },
    });
    actAs(userB.id);
    const res = await postBackup(jsonReq({ payload: dumpA, confirmReplace: true }));
    expect(res.status).toBe(200);

    // Field-for-field lossless round trip (ids regenerated, so compare the
    // re-export of user B against user A's export).
    const dumpB = await (await getBackup(getReq())).json();
    expect(comparable(dumpB)).toEqual(comparable(dumpA));

    // Ownership-scoped: user A's data is untouched, user B owns a full copy.
    expect(await countsFor(userA.id)).toEqual(countsA);
    expect(await countsFor(userB.id)).toEqual(countsA);

    // The goal was re-linked to user B's own copy of the exercise.
    const goalB = await db.exerciseGoal.findFirst({
      where: { userId: userB.id },
      include: { exercise: true },
    });
    expect(goalB?.exercise.userId).toBe(userB.id);
    expect(goalB?.exercise.name).toBe('Bench Press');

    // The profile (including deload state) was restored onto user B.
    const profileB = await db.user.findUnique({ where: { id: userB.id } });
    expect(profileB?.displayName).toBe('Julien');
    expect(profileB?.unit).toBe('LB');
    expect(profileB?.deloadUntil?.toISOString()).toBe('2026-07-05T00:00:00.000Z');
    const activeGymB = await db.gym.findFirst({ where: { id: profileB?.activeGymId ?? '' } });
    expect(activeGymB?.name).toBe('Basement');
    expect(profileB?.email).toBe('b@test.dev');
  });

  it('redacts legacy coach payloads again during restore', async () => {
    const source = await seedFullUser('coach-prompt-source@test.dev');
    actAs(source.id);
    const dump = await (await getBackup(getReq())).json();
    dump.coachSessions[0].prompt = JSON.stringify({
      generatedAt: '2026-07-20T00:00:00.000Z',
      userProfile: { coachingProfile: { privateField: 'must-not-survive' } },
    });

    const target = await db.user.create({
      data: { email: 'coach-prompt-target@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const response = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));

    expect(response.status).toBe(200);
    const restored = await db.coachSession.findFirstOrThrow({ where: { userId: target.id } });
    expect(restored.prompt).toBe(createCoachAuditPrompt('legacy-redacted'));
    expect(restored.prompt).not.toContain('coachingProfile');
    expect(restored.prompt).not.toContain('privateField');
  });

  it('round-trips ordered membership timestamps and accepts legacy v9 name-only rows', async () => {
    const userA = await seedFullUser('membership-a@test.dev');
    const [sessionA, pullupA] = await Promise.all([
      db.session.findFirstOrThrow({ where: { userId: userA.id } }),
      db.exercise.findFirstOrThrow({ where: { userId: userA.id, name: 'Pull-up' } }),
    ]);
    const [dipA, rowA] = await Promise.all([
      db.exercise.create({
        data: {
          userId: userA.id,
          name: 'Dip',
          muscleGroup: 'TRICEPS',
          category: 'COMPOUND',
          equipmentType: 'BODYWEIGHT',
        },
      }),
      db.exercise.create({
        data: {
          userId: userA.id,
          name: 'Membership row',
          muscleGroup: 'BACK_THICKNESS',
          category: 'COMPOUND',
          equipmentType: 'CABLE',
        },
      }),
    ]);
    const orphanMemberships = [
      { exercise: dipA, completedAt: '2026-06-01T10:20:00.000Z' },
      { exercise: pullupA, completedAt: '2026-06-01T10:20:00.000Z' },
      { exercise: rowA, completedAt: '2026-06-01T10:40:00.000Z' },
    ];
    for (const [index, membership] of orphanMemberships.entries()) {
      const temporarySet = await db.set.create({
        data: {
          sessionId: sessionA.id,
          exerciseId: membership.exercise.id,
          setNumber: index + 1,
          weight: 0,
          reps: 8,
          completedAt: new Date(membership.completedAt),
        },
      });
      await db.set.delete({ where: { id: temporarySet.id } });
    }
    await db.sessionExercise.update({
      where: {
        sessionId_exerciseId: { sessionId: sessionA.id, exerciseId: rowA.id },
      },
      data: { ordinal: 2_147_483_647 },
    });

    actAs(userA.id);
    const dump = await (await getBackup(getReq())).json();
    const expectedMemberships = [
      { exerciseName: 'Bench Press', addedAt: '2026-06-01T10:10:00.000Z', ordinal: 0 },
      { exerciseName: 'Dip', addedAt: '2026-06-01T10:20:00.000Z', ordinal: 2 },
      { exerciseName: 'Pull-up', addedAt: '2026-06-01T10:20:00.000Z', ordinal: 3 },
      {
        exerciseName: 'Membership row',
        addedAt: '2026-06-01T10:40:00.000Z',
        ordinal: 2_147_483_647,
      },
      { exerciseName: 'Running', addedAt: '2026-06-01T10:50:00.000Z', ordinal: 1 },
    ];
    expect(dump.sessions[0].exerciseMemberships).toEqual(expectedMemberships);
    expect(dump.sessions[0].exerciseNames).toEqual(
      expectedMemberships.map((membership) => membership.exerciseName),
    );
    for (const { exerciseName } of expectedMemberships.slice(1, 4)) {
      expect(
        dump.sessions[0].sets.some(
          (set: { exerciseName: string }) => set.exerciseName === exerciseName,
        ),
      ).toBe(false);
    }

    const userB = await db.user.create({
      data: { email: 'membership-b@test.dev', passwordHash: 'x' },
    });
    actAs(userB.id);
    const response = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(response.status).toBe(200);

    const restoredMemberships = await db.sessionExercise.findMany({
      where: { session: { userId: userB.id } },
      orderBy: [{ addedAt: 'asc' }, { ordinal: 'asc' }],
      include: { exercise: { select: { name: true } } },
    });
    expect(
      restoredMemberships.map((membership) => ({
        exerciseName: membership.exercise.name,
        addedAt: membership.addedAt.toISOString(),
        ordinal: membership.ordinal,
      })),
    ).toEqual(expectedMemberships);

    const restoredDump = await (await getBackup(getReq())).json();
    expect(restoredDump.sessions[0].exerciseMemberships).toEqual(expectedMemberships);

    const restoredSessionId = restoredMemberships[0]!.sessionId;
    const restoredMaxMembership = restoredMemberships.find(
      (membership) => membership.exercise.name === 'Membership row',
    )!;
    await db.set.create({
      data: {
        sessionId: restoredSessionId,
        exerciseId: restoredMaxMembership.exerciseId,
        setNumber: 99,
        weight: 0,
        reps: 1,
        completedAt: new Date('2026-06-01T11:00:00.000Z'),
      },
    });
    expect(
      await db.sessionExercise.findUniqueOrThrow({
        where: {
          sessionId_exerciseId: {
            sessionId: restoredSessionId,
            exerciseId: restoredMaxMembership.exerciseId,
          },
        },
      }),
    ).toMatchObject({ ordinal: 2_147_483_647 });

    const appendedExercise = await db.exercise.create({
      data: {
        userId: userB.id,
        name: 'Post-import membership',
        muscleGroup: 'OTHER',
        category: 'ISOLATION',
      },
    });
    await db.set.create({
      data: {
        sessionId: restoredSessionId,
        exerciseId: appendedExercise.id,
        setNumber: 1,
        weight: 0,
        reps: 1,
        completedAt: new Date('2026-06-01T11:10:00.000Z'),
      },
    });
    const compactedMemberships = await db.sessionExercise.findMany({
      where: { sessionId: restoredSessionId },
      orderBy: { ordinal: 'asc' },
      include: { exercise: { select: { name: true } } },
    });
    expect(compactedMemberships.map((membership) => membership.ordinal)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(compactedMemberships.at(-1)?.exercise.name).toBe('Post-import membership');
    const compactedDump = await (await getBackup(getReq())).json();
    expect(
      compactedDump.sessions[0].exerciseMemberships.map(
        (membership: { exerciseName: string }) => membership.exerciseName,
      ),
    ).toEqual([
      ...expectedMemberships.map((membership) => membership.exerciseName),
      'Post-import membership',
    ]);

    const legacyStructuredDump = structuredClone(dump);
    legacyStructuredDump.version = 9;
    for (const membership of legacyStructuredDump.sessions[0].exerciseMemberships) {
      delete membership.ordinal;
    }
    const userC = await db.user.create({
      data: { email: 'membership-c@test.dev', passwordHash: 'x' },
    });
    actAs(userC.id);
    const legacyStructuredResponse = await postBackup(
      jsonReq({ payload: legacyStructuredDump, confirmReplace: true }),
    );
    expect(legacyStructuredResponse.status).toBe(200);
    const legacyStructuredExport = await (await getBackup(getReq())).json();
    expect(
      legacyStructuredExport.sessions[0].exerciseMemberships.map(
        (membership: { exerciseName: string; addedAt: string }) => ({
          exerciseName: membership.exerciseName,
          addedAt: membership.addedAt,
        }),
      ),
    ).toEqual(expectedMemberships.map(({ exerciseName, addedAt }) => ({ exerciseName, addedAt })));

    const legacyV9Dump = structuredClone(dump);
    legacyV9Dump.version = 9;
    delete legacyV9Dump.sessions[0].exerciseMemberships;
    const userD = await db.user.create({
      data: { email: 'membership-d@test.dev', passwordHash: 'x' },
    });
    actAs(userD.id);
    const legacyResponse = await postBackup(
      jsonReq({ payload: legacyV9Dump, confirmReplace: true }),
    );
    expect(legacyResponse.status).toBe(200);
    expect(
      (
        await db.sessionExercise.findMany({
          where: { session: { userId: userD.id } },
          include: { exercise: { select: { name: true } } },
        })
      )
        .map((membership) => membership.exercise.name)
        .sort(),
    ).toEqual(expectedMemberships.map((membership) => membership.exerciseName).sort());
  });

  it('round-trips equipment compatibility-mirror provenance in version 10', async () => {
    const source = await seedFullUser('mirror-backup-source@test.dev');
    const [gym, equipment, exercise] = await Promise.all([
      db.gym.findFirstOrThrow({ where: { userId: source.id, name: 'Basement' } }),
      db.gymEquipment.findFirstOrThrow({
        where: { gym: { userId: source.id }, name: 'Competition bench station' },
      }),
      db.exercise.findFirstOrThrow({ where: { userId: source.id, name: 'Bench Press' } }),
    ]);
    await db.gymEquipmentExercise.update({
      where: {
        equipmentId_exerciseId: { equipmentId: equipment.id, exerciseId: exercise.id },
      },
      data: { mirrorsLegacyConfig: true },
    });
    await db.gymExerciseConfig.update({
      where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      data: { isAvailable: true, isEquipmentMirror: true },
    });

    actAs(source.id);
    const dump = await (await getBackup(getReq())).json();
    expect(dump.gyms[0].equipment[0].legacyMirrorExerciseNames).toEqual(['Bench Press']);
    expect(
      dump.gyms[0].exerciseConfigs.find(
        (config: { exerciseName: string }) => config.exerciseName === 'Bench Press',
      ),
    ).toMatchObject({ isEquipmentMirror: true, weightOptions: [] });

    const target = await db.user.create({
      data: { email: 'mirror-backup-target@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    const response = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(response.status).toBe(200);
    const [restoredLink, restoredConfig] = await Promise.all([
      db.gymEquipmentExercise.findFirstOrThrow({
        where: {
          equipment: { gym: { userId: target.id }, name: 'Competition bench station' },
          exercise: { userId: target.id, name: 'Bench Press' },
        },
      }),
      db.gymExerciseConfig.findFirstOrThrow({
        where: {
          gym: { userId: target.id, name: 'Basement' },
          exercise: { userId: target.id, name: 'Bench Press' },
        },
      }),
    ]);
    expect(restoredLink.mirrorsLegacyConfig).toBe(true);
    expect(restoredConfig.isEquipmentMirror).toBe(true);
  });

  it('round-trips preferred equipment and accepts an older payload without the optional field', async () => {
    const source = await seedFullUser('preferred-backup-source@test.dev');
    const [gym, equipment, exercise] = await Promise.all([
      db.gym.findFirstOrThrow({ where: { userId: source.id, name: 'Basement' } }),
      db.gymEquipment.findFirstOrThrow({
        where: { gym: { userId: source.id }, name: 'Competition bench station' },
      }),
      db.exercise.findFirstOrThrow({ where: { userId: source.id, name: 'Bench Press' } }),
    ]);
    await db.gymExerciseConfig.upsert({
      where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      update: { preferredEquipmentId: equipment.id, isEquipmentMirror: false },
      create: {
        gymId: gym.id,
        exerciseId: exercise.id,
        preferredEquipmentId: equipment.id,
      },
    });

    actAs(source.id);
    const dump = await (await getBackup(getReq())).json();
    expect(
      dump.gyms[0].exerciseConfigs.find(
        (config: { exerciseName: string }) => config.exerciseName === 'Bench Press',
      ),
    ).toMatchObject({ preferredEquipmentName: 'Competition bench station' });

    const target = await db.user.create({
      data: { email: 'preferred-backup-target@test.dev', passwordHash: 'x' },
    });
    actAs(target.id);
    expect((await postBackup(jsonReq({ payload: dump, confirmReplace: true }))).status).toBe(200);
    expect(
      await db.gymExerciseConfig.findFirstOrThrow({
        where: {
          gym: { userId: target.id, name: 'Basement' },
          exercise: { userId: target.id, name: 'Bench Press' },
        },
        include: { preferredEquipment: true },
      }),
    ).toMatchObject({ preferredEquipment: { name: 'Competition bench station' } });

    const legacyTarget = await db.user.create({
      data: { email: 'preferred-backup-legacy@test.dev', passwordHash: 'x' },
    });
    const legacyDump = structuredClone(dump);
    legacyDump.version = 10;
    for (const legacyGym of legacyDump.gyms) {
      for (const config of legacyGym.exerciseConfigs) delete config.preferredEquipmentName;
    }
    actAs(legacyTarget.id);
    expect((await postBackup(jsonReq({ payload: legacyDump, confirmReplace: true }))).status).toBe(
      200,
    );
  });

  it('rejects an invalid preferred equipment tuple before replacing existing account data', async () => {
    const source = await seedFullUser('preferred-backup-invalid-source@test.dev');
    const [gym, equipment, exercise] = await Promise.all([
      db.gym.findFirstOrThrow({ where: { userId: source.id, name: 'Basement' } }),
      db.gymEquipment.findFirstOrThrow({
        where: { gym: { userId: source.id }, name: 'Competition bench station' },
      }),
      db.exercise.findFirstOrThrow({ where: { userId: source.id, name: 'Bench Press' } }),
    ]);
    await db.gymExerciseConfig.upsert({
      where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      update: { preferredEquipmentId: equipment.id, isEquipmentMirror: false },
      create: {
        gymId: gym.id,
        exerciseId: exercise.id,
        preferredEquipmentId: equipment.id,
      },
    });

    actAs(source.id);
    const dump = await (await getBackup(getReq())).json();
    const dumpedGym = dump.gyms.find((item: { name: string }) => item.name === 'Basement');
    const dumpedEquipment = dumpedGym.equipment.find(
      (item: { name: string }) => item.name === 'Competition bench station',
    );
    dumpedEquipment.exerciseNames = [];

    const target = await db.user.create({
      data: { email: 'preferred-backup-invalid-target@test.dev', passwordHash: 'x' },
    });
    const retainedExercise = await db.exercise.create({
      data: {
        userId: target.id,
        name: 'Keep me',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    actAs(target.id);

    const response = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Preferred equipment must be linked to an exercise with a compatible equipment type.',
    });
    expect(await db.exercise.findUnique({ where: { id: retainedExercise.id } })).not.toBeNull();
  });

  it('rejects inconsistent legacy v1 equipment snapshots before replacing account data', async () => {
    const source = await seedFullUser('snapshot-source@test.dev');
    actAs(source.id);
    const dump = await (await getBackup(getReq())).json();

    const cases = [
      {
        email: 'snapshot-weight-mismatch@test.dev',
        expectedError: 'The recorded equipment snapshot fields are inconsistent.',
        mutate: (set: Record<string, unknown>) => {
          set.weight = Number(set.selectedLoadKg) + 5;
        },
      },
      {
        email: 'snapshot-top-level-mismatch@test.dev',
        expectedError: 'The recorded equipment snapshot fields are inconsistent.',
        mutate: (set: Record<string, unknown>) => {
          set.selectedLoadMultiplier = 2;
        },
      },
      {
        email: 'snapshot-load-type-mismatch@test.dev',
        expectedError: 'The recorded equipment snapshot fields are inconsistent.',
        mutate: (set: Record<string, unknown>) => {
          (set.equipmentLoadSnapshot as Record<string, unknown>).nominalResistanceKg = 999;
          set.nominalResistanceKg = 999;
        },
      },
      {
        email: 'snapshot-missing-plate-pool@test.dev',
        expectedError: 'The recorded equipment snapshot is unsupported or invalid.',
        mutate: (set: Record<string, unknown>) => {
          (set.equipmentLoadSnapshot as Record<string, unknown>).platePool = null;
        },
      },
      {
        email: 'snapshot-unexpected-plate-pool@test.dev',
        expectedError: 'The recorded equipment snapshot is unsupported or invalid.',
        mutate: (set: Record<string, unknown>) => {
          (set.equipmentLoadSnapshot as Record<string, unknown>).loadType = 'FIXED';
        },
      },
    ];

    for (const testCase of cases) {
      const target = await db.user.create({
        data: { email: testCase.email, passwordHash: 'x' },
      });
      await db.exercise.create({
        data: {
          userId: target.id,
          name: 'Keep existing data',
          muscleGroup: 'OTHER',
          category: 'ISOLATION',
        },
      });
      const payload = structuredClone(dump);
      const strengthSet = payload.sessions[0].sets.find(
        (set: { exerciseName: string }) => set.exerciseName === 'Bench Press',
      ) as Record<string, unknown>;
      testCase.mutate(strengthSet);

      actAs(target.id);
      const response = await postBackup(jsonReq({ payload, confirmReplace: true }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: testCase.expectedError,
      });
      expect(
        await db.exercise.findUnique({
          where: { userId_name: { userId: target.id, name: 'Keep existing data' } },
        }),
      ).not.toBeNull();
    }
  });

  it('still restores a version 1 backup (fields and models added in v2 absent)', async () => {
    const user = await db.user.create({
      data: { email: 'v1@test.dev', passwordHash: 'x', displayName: 'Keep Me' },
    });
    actAs(user.id);

    // Shape produced by the pre-#168 route: no profile, no v2 models, sets
    // and program exercises without the v2 fields.
    const v1Payload = {
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      user: { email: 'v1@test.dev', createdAt: '2025-01-01T00:00:00.000Z' },
      exercises: [
        {
          name: 'Squat',
          muscleGroup: 'QUADS',
          category: 'COMPOUND',
          defaultRestSec: 180,
          notes: null,
        },
      ],
      programs: [
        {
          name: 'Old Block',
          description: null,
          phase: 'base',
          isActive: false,
          startDate: '2025-11-01T00:00:00.000Z',
          endDate: null,
          workouts: [
            {
              name: 'Legs',
              dayOfWeek: 2,
              order: 1,
              exercises: [
                {
                  exerciseName: 'Squat',
                  order: 1,
                  targetSets: 4,
                  targetRepsMin: 5,
                  targetRepsMax: 8,
                  targetRIR: 1,
                  restSec: 180,
                  tempo: null,
                  notes: null,
                },
              ],
            },
          ],
        },
      ],
      sessions: [
        {
          programName: 'Old Block',
          workoutName: 'Legs',
          startedAt: '2025-11-03T10:00:00.000Z',
          finishedAt: null,
          notes: null,
          sets: [
            {
              exerciseName: 'Squat',
              setNumber: 1,
              weight: 140,
              reps: 5,
              rir: 1,
              notes: null,
              isWarmup: false,
              isDropSet: false,
              completedAt: '2025-11-03T10:15:00.000Z',
            },
          ],
        },
      ],
      coachSessions: [],
    };

    const res = await postBackup(jsonReq({ payload: v1Payload, confirmReplace: true }));
    expect(res.status).toBe(200);

    const counts = await countsFor(user.id);
    expect(counts.exercises).toBe(1);
    expect(counts.programs).toBe(1);
    expect(counts.sets).toBe(1);
    expect(counts.goals).toBe(0);
    expect(counts.bodyweightEntries).toBe(0);
    expect(counts.readinessCheckins).toBe(0);
    expect(counts.conversations).toBe(0);

    // v2 fields default to their pre-#168 values.
    const squat = await db.exercise.findFirst({ where: { userId: user.id } });
    expect(squat?.usesBodyweight).toBe(false);
    const pe = await db.programExercise.findFirst({
      where: { workout: { program: { userId: user.id } } },
    });
    expect(pe?.supersetGroup).toBeNull();
    const set = await db.set.findFirst({ where: { session: { userId: user.id } } });
    expect(set?.durationSec).toBeNull();
    expect(set?.avgHr).toBeNull();
    expect(set?.maxHr).toBeNull();

    // No profile in a v1 file: the account's profile is left alone.
    const profile = await db.user.findUnique({ where: { id: user.id } });
    expect(profile?.displayName).toBe('Keep Me');
  });
});

describe('POST /api/backup - malformed and oversized input (issue #168)', () => {
  it('rejects a system Barbell member assigned to a different pool family', async () => {
    const user = await seedFullUser('victim-family@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup(getReq())).json();
    dump.gyms[0].equipment[0].systemBarbellFamily = 'SMALL';

    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects out-of-bounds values without touching existing data', async () => {
    const user = await seedFullUser('victim@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup(getReq())).json();

    dump.sessions[0].sets[0].avgHr = 999; // out of the 40..250 range
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);

    // Validation failed before the transaction: nothing was deleted.
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects an out-of-bounds max HR without touching existing data (issue #203)', async () => {
    const user = await seedFullUser('victim-maxhr@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup(getReq())).json();

    dump.sessions[0].sets[0].maxHr = 999; // out of the 40..250 range
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects an out-of-range date as a clean 400, not a Prisma 500', async () => {
    const user = await seedFullUser('victim-date@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup(getReq())).json();

    // Year 275760 parses in JS Date but is far outside PostgreSQL's range;
    // it must be rejected by validation, not 500 deep in Prisma.
    dump.sessions[0].startedAt = '+275760-09-13T00:00:00.000Z';
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(400);
    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rejects a non-JSON body and a missing confirmReplace', async () => {
    const user = await seedFullUser('victim2@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);

    const notJson = await postBackup(
      new Request('http://test.local/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json {{{',
      }),
    );
    expect(notJson.status).toBe(400);

    const dump = await (await getBackup(getReq())).json();
    const noConfirm = await postBackup(jsonReq({ payload: dump, confirmReplace: false }));
    expect(noConfirm.status).toBe(400);

    expect(await countsFor(user.id)).toEqual(before);
  });

  it('rolls back the whole restore when a row fails mid-transaction', async () => {
    const user = await seedFullUser('victim3@test.dev');
    actAs(user.id);
    const before = await countsFor(user.id);
    const dump = await (await getBackup(getReq())).json();
    const pristine = JSON.parse(JSON.stringify(dump));

    // Passes Zod but violates the (userId, name) unique constraint during the
    // restore: the transaction must roll back, leaving the user's previous
    // data fully intact (not wiped, not partially replaced).
    dump.exercises.push({ ...dump.exercises[0] });
    const res = await postBackup(jsonReq({ payload: dump, confirmReplace: true }));
    expect(res.status).toBe(409);

    expect(await countsFor(user.id)).toEqual(before);
    const dumpAfter = await (await getBackup(getReq())).json();
    expect(comparable(dumpAfter)).toEqual(comparable(pristine));
  });

  it('rejects an oversized body with 413 while reading it', async () => {
    const user = await db.user.create({
      data: { email: 'big@test.dev', passwordHash: 'x' },
    });
    actAs(user.id);

    // 50 MiB cap: a body just past it must be cut off during the read.
    const oversized = '{"payload": "' + 'x'.repeat(50 * 1024 * 1024) + '"}';
    const res = await postBackup(
      new Request('http://test.local/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: oversized,
      }),
    );
    expect(res.status).toBe(413);
  });

  it('rejects an array past its cap (oversized backup shape)', async () => {
    const user = await db.user.create({
      data: { email: 'flood@test.dev', passwordHash: 'x' },
    });
    actAs(user.id);

    const entries = Array.from({ length: 20001 }, (_, i) => ({
      weightKg: 80,
      measuredAt: new Date(1700000000000 + i * 1000).toISOString(),
      note: null,
    }));
    const res = await postBackup(
      jsonReq({
        payload: {
          version: 2,
          exercises: [],
          programs: [],
          sessions: [],
          bodyweightEntries: entries,
        },
        confirmReplace: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(await db.bodyweightEntry.count({ where: { userId: user.id } })).toBe(0);
  });
});
