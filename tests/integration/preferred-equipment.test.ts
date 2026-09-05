import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { setOwnedPreferredGymEquipment } from '@/lib/gym-equipment';

async function seed() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await db.user.create({ data: { email: `pref-${suffix}@test.dev`, passwordHash: 'x' } });
  const stranger = await db.user.create({ data: { email: `pref-other-${suffix}@test.dev`, passwordHash: 'x' } });
  const gym = await db.gym.create({ data: { userId: user.id, name: `Gym ${suffix}` } });
  const otherGym = await db.gym.create({ data: { userId: user.id, name: `Other ${suffix}` } });
  const exercise = await db.exercise.create({
    data: {
      userId: user.id,
      name: `Cable row ${suffix}`,
      muscleGroup: 'BACK_THICKNESS',
      category: 'COMPOUND',
      equipmentType: 'CABLE',
    },
  });
  const cable = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: `Cable ${suffix}`,
      equipmentType: 'CABLE',
      exerciseLinks: { create: { exerciseId: exercise.id } },
    },
  });
  const unlinked = await db.gymEquipment.create({
    data: { gymId: gym.id, name: `Unlinked ${suffix}`, equipmentType: 'CABLE' },
  });
  const wrongType = await db.gymEquipment.create({
    data: {
      gymId: gym.id,
      name: `Machine ${suffix}`,
      equipmentType: 'MACHINE',
      exerciseLinks: { create: { exerciseId: exercise.id } },
    },
  });
  const wrongGym = await db.gymEquipment.create({
    data: {
      gymId: otherGym.id,
      name: `Other cable ${suffix}`,
      equipmentType: 'CABLE',
      exerciseLinks: { create: { exerciseId: exercise.id } },
    },
  });
  return { user, stranger, gym, exercise, cable, unlinked, wrongType, wrongGym };
}

describe('preferred equipment per exercise/gym', () => {
  it('sets and clears only linked compatible equipment in the owned gym', async () => {
    const { user, gym, exercise, cable } = await seed();
    await expect(
      setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, cable.id),
    ).resolves.toMatchObject({ preferredEquipmentId: cable.id });
    expect(
      await db.gymExerciseConfig.findUnique({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: cable.id, isAvailable: true });

    await expect(
      setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, null),
    ).resolves.toMatchObject({ preferredEquipmentId: null });
    expect(
      (
        await db.gymExerciseConfig.findUniqueOrThrow({
          where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
        })
      ).preferredEquipmentId,
    ).toBeNull();
  });

  it('rejects foreign ownership, wrong gym, unlinked equipment, and incompatible type', async () => {
    const { user, stranger, gym, exercise, unlinked, wrongType, wrongGym } = await seed();
    await expect(
      setOwnedPreferredGymEquipment(stranger.id, gym.id, exercise.id, null),
    ).rejects.toThrow(/gym not found/i);
    await expect(
      setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, unlinked.id),
    ).rejects.toThrow(/linked/i);
    await expect(
      setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, wrongGym.id),
    ).rejects.toThrow(/linked/i);
    await expect(
      setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, wrongType.id),
    ).rejects.toThrow(/type/i);
  });

  it('does not change exercise availability when setting a preference on an existing config', async () => {
    const { user, gym, exercise, cable } = await seed();
    await db.gymExerciseConfig.create({
      data: { gymId: gym.id, exerciseId: exercise.id, isAvailable: false },
    });

    await setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, cable.id);

    expect(
      await db.gymExerciseConfig.findUniqueOrThrow({
        where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
      }),
    ).toMatchObject({ preferredEquipmentId: cable.id, isAvailable: false });
  });

  it('clears the preference automatically when preferred equipment is deleted', async () => {
    const { user, gym, exercise, cable } = await seed();
    await setOwnedPreferredGymEquipment(user.id, gym.id, exercise.id, cable.id);
    await db.gymEquipment.delete({ where: { id: cable.id } });
    expect(
      (
        await db.gymExerciseConfig.findUniqueOrThrow({
          where: { gymId_exerciseId: { gymId: gym.id, exerciseId: exercise.id } },
        })
      ).preferredEquipmentId,
    ).toBeNull();
  });
});
