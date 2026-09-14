import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { createOwnedGym } from '@/lib/gym-equipment';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('owned gym creation', () => {
  it('clones current physical inventory without changing the active gym', async () => {
    const user = await db.user.create({
      data: { email: `gym-clone-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const exercise = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Lat Pulldown',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
        equipmentType: 'CABLE',
      },
    });
    const source = await db.gym.create({
      data: {
        userId: user.id,
        name: 'Olymp',
        dumbbellWeights: [10, 12.5],
        plateWeights: [1.25, 2.5, 5],
        barWeights: [20],
        exerciseConfigs: {
          create: { exerciseId: exercise.id, isAvailable: true, weightOptions: [10, 20, 30] },
        },
      },
    });
    const sourceEquipment = await db.gymEquipment.create({
      data: {
        gymId: source.id,
        name: 'Lat pulldown station',
        equipmentType: 'CABLE',
        weightOptions: [10, 20, 30],
        imageData: PNG,
        imageMimeType: 'image/png',
        exerciseLinks: { create: { exerciseId: exercise.id } },
      },
    });
    await db.user.update({ where: { id: user.id }, data: { activeGymId: source.id } });

    const created = await createOwnedGym(user.id, {
      name: 'Xfit',
      sourceGymId: source.id,
      makeActive: false,
    });

    expect(created).toMatchObject({
      gym: { name: 'Xfit', isActive: false, _count: { equipment: 1, exerciseConfigs: 1 } },
      clonedFromGym: { id: source.id, name: source.name },
    });
    const clone = await db.gym.findUniqueOrThrow({
      where: { id: created.gym.id },
      include: { exerciseConfigs: true, equipment: { include: { exerciseLinks: true } } },
    });
    expect(clone.dumbbellWeights).toEqual([10, 12.5]);
    expect(clone.exerciseConfigs[0]).toMatchObject({
      exerciseId: exercise.id,
      isAvailable: true,
      weightOptions: [10, 20, 30],
    });
    expect(clone.equipment[0]).toMatchObject({
      name: sourceEquipment.name,
      weightOptions: [10, 20, 30],
      imageMimeType: 'image/png',
      exerciseLinks: [expect.objectContaining({ exerciseId: exercise.id })],
    });
    expect(clone.equipment[0]?.id).not.toBe(sourceEquipment.id);
    expect(Buffer.from(clone.equipment[0]?.imageData ?? [])).toEqual(PNG);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).activeGymId).toBe(
      source.id,
    );
  });

  it('rejects cloning another trainee gym', async () => {
    const owner = await db.user.create({
      data: { email: `gym-owner-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const other = await db.user.create({
      data: { email: `gym-other-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const foreignGym = await db.gym.create({ data: { userId: other.id, name: 'Foreign gym' } });

    await expect(
      createOwnedGym(owner.id, { name: 'Clone', sourceGymId: foreignGym.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.gym.count({ where: { userId: owner.id } })).toBe(0);
  });
});
