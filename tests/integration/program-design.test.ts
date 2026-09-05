import { describe, expect, it } from 'vitest';
import { Prisma } from '@/prisma/generated/client';
import { db } from '@/lib/db';
import { buildProgramDesignContext, PROGRAM_DESIGN_CONTRACT_VERSION } from '@/lib/program-design-context';
import { buildProgramFromGenerated } from '@/lib/program-generation';
import { applyCoachingProfilePatch } from '@/lib/schemas/coaching-profile';
import type { GeneratedProgram } from '@/lib/schemas/program-generation';

const draft: GeneratedProgram = {
  name: 'Next block',
  description: 'Validated external-agent draft',
  phase: 'accumulation',
  workouts: [
    {
      name: 'Full body',
      dayOfWeek: 1,
      exercises: [
        {
          name: 'Bench Press',
          muscleGroup: 'CHEST',
          category: 'COMPOUND',
          equipmentType: 'BARBELL',
          targetSets: 3,
          targetRepsMin: 5,
          targetRepsMax: 8,
          targetRIR: 2,
          restSec: 120,
        },
      ],
    },
  ],
};

async function seedKnownProfileUser(email: string) {
  const profile = applyCoachingProfilePatch(
    null,
    {
      healthStatus: { state: 'KNOWN', value: 'NO_SIGNIFICANT_ISSUES' },
      trainingLevel: { state: 'KNOWN', value: 'INTERMEDIATE' },
      availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
      limitations: { state: 'NOT_APPLICABLE' },
      maximumSessionDurationMin: { state: 'KNOWN', value: 90 },
    },
    new Date('2026-09-05T12:00:00.000Z'),
  );
  const user = await db.user.create({
    data: {
      email,
      passwordHash: 'x',
      goal: 'STRENGTH',
      coachingProfile: profile as Prisma.InputJsonValue,
      coachingProfileUpdatedAt: new Date(profile.updatedAt!),
    },
  });
  const gym = await db.gym.create({
    data: { userId: user.id, name: 'Test Gym' },
  });
  await db.user.update({ where: { id: user.id }, data: { activeGymId: gym.id } });
  await db.exercise.create({
    data: {
      userId: user.id,
      name: 'Bench Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
    },
  });
  return { user, gym };
}

describe('program-design context', () => {
  it('resolves required design facts from the structured profile and active gym', async () => {
    const { user, gym } = await seedKnownProfileUser('design-context@test.dev');

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
    });

    expect(context.designContractVersion).toBe(PROGRAM_DESIGN_CONTRACT_VERSION);
    expect(context.goal).toBe('Strength');
    expect(context.answers).toMatchObject({
      trainingExperience: 'INTERMEDIATE',
      availableDays: [1, 3, 5],
      weeklyFrequency: 3,
      sessionDurationMin: 90,
      healthStatus: 'NO_SIGNIFICANT_ISSUES',
      limitations: 'none',
    });
    expect(context.answerSources).toMatchObject({
      goal: 'profile',
      trainingExperience: 'profile',
      availableDays: 'profile',
      sessionDurationMin: 'profile',
      healthStatus: 'profile',
      limitations: 'profile',
      equipmentAccess: 'active-gym',
    });
    expect(context.gym?.id).toBe(gym.id);
    expect(context.missingQuestions).toEqual([]);
  });

  it('keeps missing legacy facts explicit instead of assuming safe defaults', async () => {
    const user = await db.user.create({
      data: { email: 'design-unknown@test.dev', passwordHash: 'x' },
    });

    const context = await buildProgramDesignContext({
      userId: user.id,
      goal: '',
      mode: 'NEW_PROGRAM',
    });

    expect(context.missingQuestions.map((question) => question.id)).toEqual(
      expect.arrayContaining([
        'healthStatus',
        'trainingExperience',
        'availableDays',
        'limitations',
        'sessionDurationMin',
        'goal',
        'equipmentAccess',
      ]),
    );
    expect(context.profile.coachingProfile.healthStatus.state).toBe('UNKNOWN');
    expect(context.safety.canCreateProgram).toBe(true);
  });

  it('rejects a source program owned by another user', async () => {
    const owner = await db.user.create({
      data: { email: 'source-owner@test.dev', passwordHash: 'x' },
    });
    const other = await db.user.create({
      data: { email: 'source-other@test.dev', passwordHash: 'x' },
    });
    const source = await db.program.create({
      data: { userId: owner.id, name: 'Owner source', phase: 'base' },
    });

    await expect(
      buildProgramDesignContext({
        userId: other.id,
        goal: 'Next phase',
        mode: 'NEXT_MESOCYCLE',
        sourceProgramId: source.id,
      }),
    ).rejects.toThrow('source program');
  });
});

describe('program revision lineage', () => {
  it('creates an inactive revision linked to the owned source and preserves provenance', async () => {
    const { user } = await seedKnownProfileUser('revision-owner@test.dev');
    const source = await db.program.create({
      data: { userId: user.id, name: 'Current block', phase: 'base', isActive: true },
    });

    const revisionId = await buildProgramFromGenerated(user.id, draft, {
      sourceProgramId: source.id,
      methodologyVersion: PROGRAM_DESIGN_CONTRACT_VERSION,
    });
    const revision = await db.program.findUniqueOrThrow({ where: { id: revisionId } });
    const unchangedSource = await db.program.findUniqueOrThrow({ where: { id: source.id } });

    expect(revision).toMatchObject({
      userId: user.id,
      parentProgramId: source.id,
      methodologyVersion: PROGRAM_DESIGN_CONTRACT_VERSION,
      isActive: false,
    });
    expect(unchangedSource.isActive).toBe(true);
  });

  it('rejects cross-user lineage before creating any program', async () => {
    const owner = await db.user.create({
      data: { email: 'lineage-owner@test.dev', passwordHash: 'x' },
    });
    const other = await db.user.create({
      data: { email: 'lineage-other@test.dev', passwordHash: 'x' },
    });
    const source = await db.program.create({
      data: { userId: owner.id, name: 'Private source', phase: 'base' },
    });
    const before = await db.program.count({ where: { userId: other.id } });

    await expect(
      buildProgramFromGenerated(other.id, draft, {
        sourceProgramId: source.id,
        methodologyVersion: PROGRAM_DESIGN_CONTRACT_VERSION,
      }),
    ).rejects.toThrow('Source program not found');

    expect(await db.program.count({ where: { userId: other.id } })).toBe(before);
  });
});
