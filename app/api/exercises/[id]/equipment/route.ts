import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { reconcileLegacyExerciseConfigMirrors } from '@/lib/gym-equipment';
import { exerciseEquipmentUpdateSchema } from '@/lib/schemas/exercise';
import { resolveEquipmentType } from '@/lib/gym-loads';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, props: Params) {
  const { id } = await props.params;
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, exerciseEquipmentUpdateSchema);
    const exercise = await db.exercise.findFirst({
      where: { id, userId },
      select: { id: true, name: true, equipmentType: true },
    });
    if (!exercise) throw new ApiError(404, 'Exercise not found.');
    const resolvedExerciseType = resolveEquipmentType(exercise.equipmentType, exercise.name);

    if ('gyms' in input) {
      const selections = input.gyms.map((selection) => ({
        gymId: selection.gymId,
        equipmentIds: [...new Set(selection.equipmentIds)],
        preferredEquipmentId: selection.preferredEquipmentId ?? null,
      }));
      if (new Set(selections.map((selection) => selection.gymId)).size !== selections.length) {
        throw new ApiError(400, 'Each gym may appear only once.');
      }

      const ownedGyms = await db.gym.findMany({
        where: { userId, id: { in: selections.map((selection) => selection.gymId) } },
        select: { id: true },
      });
      if (ownedGyms.length !== selections.length) {
        throw new ApiError(400, 'One or more gyms do not belong to the trainee.');
      }

      const requestedEquipmentIds = [
        ...new Set(selections.flatMap((selection) => selection.equipmentIds)),
      ];
      const requestedEquipment = requestedEquipmentIds.length
        ? await db.gymEquipment.findMany({
            where: { id: { in: requestedEquipmentIds }, gym: { userId } },
            select: { id: true, gymId: true, equipmentType: true, systemBarbellFamily: true },
          })
        : [];
      if (requestedEquipment.length !== requestedEquipmentIds.length) {
        throw new ApiError(400, 'One or more equipment IDs do not belong to the trainee.');
      }
      const equipmentById = new Map(requestedEquipment.map((item) => [item.id, item]));
      const managedBars = await db.gymEquipment.findMany({
        where: {
          gymId: { in: selections.map((selection) => selection.gymId) },
          gym: { userId },
          systemBarbellFamily: { not: null },
        },
        select: { id: true, gymId: true },
      });
      const managedBarIdsByGym = new Map<string, string[]>();
      for (const bar of managedBars) {
        const ids = managedBarIdsByGym.get(bar.gymId) ?? [];
        ids.push(bar.id);
        managedBarIdsByGym.set(bar.gymId, ids);
      }

      for (const selection of selections) {
        if (
          selection.equipmentIds.some(
            (equipmentId) => equipmentById.get(equipmentId)?.gymId !== selection.gymId,
          )
        ) {
          throw new ApiError(400, 'Equipment must belong to the selected gym.');
        }
        if (selection.preferredEquipmentId) {
          const preferred = equipmentById.get(selection.preferredEquipmentId);
          if (!selection.equipmentIds.includes(selection.preferredEquipmentId) || !preferred) {
            throw new ApiError(400, 'Preferred equipment must remain linked to the exercise.');
          }
          if (preferred.equipmentType !== resolvedExerciseType) {
            throw new ApiError(400, 'Preferred equipment type must match the exercise type.');
          }
        }
        const systemBarIds = managedBarIdsByGym.get(selection.gymId) ?? [];
        const selectedSystemBarIds = selection.equipmentIds.filter((equipmentId) =>
          systemBarIds.includes(equipmentId),
        );
        if (selectedSystemBarIds.length > 0 && resolvedExerciseType !== 'BARBELL') {
          throw new ApiError(400, 'System Barbell members support only barbell exercises.');
        }
        if (
          selectedSystemBarIds.length > 0 &&
          selectedSystemBarIds.length !== systemBarIds.length
        ) {
          throw new ApiError(
            400,
            'Select all system bars through the Barbell profile instead of editing one bar.',
          );
        }
      }

      await db.$transaction(async (tx) => {
        for (const selection of selections) {
          await tx.gymEquipmentExercise.deleteMany({
            where: { exerciseId: id, equipment: { gymId: selection.gymId } },
          });
          if (selection.equipmentIds.length > 0) {
            await tx.gymEquipmentExercise.createMany({
              data: selection.equipmentIds.map((equipmentId) => ({
                equipmentId,
                exerciseId: id,
                mirrorsLegacyConfig: false,
              })),
            });
          }
          if (selection.preferredEquipmentId) {
            await tx.gymExerciseConfig.upsert({
              where: { gymId_exerciseId: { gymId: selection.gymId, exerciseId: id } },
              update: {
                preferredEquipmentId: selection.preferredEquipmentId,
                isEquipmentMirror: false,
              },
              create: {
                gymId: selection.gymId,
                exerciseId: id,
                isAvailable: true,
                preferredEquipmentId: selection.preferredEquipmentId,
                isEquipmentMirror: false,
              },
            });
          } else {
            await tx.gymExerciseConfig.updateMany({
              where: { gymId: selection.gymId, exerciseId: id },
              data: { preferredEquipmentId: null },
            });
          }
          const systemBarIds = managedBarIdsByGym.get(selection.gymId) ?? [];
          if (resolvedExerciseType === 'BARBELL' && systemBarIds.length > 0) {
            const supportsSystemProfile = systemBarIds.every((equipmentId) =>
              selection.equipmentIds.includes(equipmentId),
            );
            await tx.gymExerciseConfig.upsert({
              where: { gymId_exerciseId: { gymId: selection.gymId, exerciseId: id } },
              update: { systemProfileSupported: supportsSystemProfile },
              create: {
                gymId: selection.gymId,
                exerciseId: id,
                isAvailable: true,
                systemProfileSupported: supportsSystemProfile,
              },
            });
          }
          await reconcileLegacyExerciseConfigMirrors(tx, selection.gymId, [id]);
        }
      });

      return NextResponse.json({ ok: true, gyms: selections });
    }

    const ownedEquipment = await db.gymEquipment.findMany({
      where: { gym: { userId } },
      select: { id: true, gymId: true, systemBarbellFamily: true },
    });
    const ownedIds = new Set(ownedEquipment.map((item) => item.id));
    const requestedIds = [...new Set(input.equipmentIds)];
    if (requestedIds.some((equipmentId) => !ownedIds.has(equipmentId))) {
      throw new ApiError(400, 'One or more equipment IDs do not belong to the trainee.');
    }
    for (const gymId of new Set(ownedEquipment.map((item) => item.gymId))) {
      const systemBarIds = ownedEquipment
        .filter((item) => item.gymId === gymId && item.systemBarbellFamily != null)
        .map((item) => item.id);
      const selectedSystemBarIds = systemBarIds.filter((equipmentId) =>
        requestedIds.includes(equipmentId),
      );
      if (selectedSystemBarIds.length > 0 && resolvedExerciseType !== 'BARBELL') {
        throw new ApiError(400, 'System Barbell members support only barbell exercises.');
      }
      if (selectedSystemBarIds.length > 0 && selectedSystemBarIds.length !== systemBarIds.length) {
        throw new ApiError(
          400,
          'Select all system bars through the Barbell profile instead of editing one bar.',
        );
      }
    }

    await db.$transaction(async (tx) => {
      if (ownedEquipment.length > 0) {
        await tx.gymEquipmentExercise.deleteMany({
          where: { exerciseId: id, equipmentId: { in: ownedEquipment.map((item) => item.id) } },
        });
      }
      if (requestedIds.length > 0) {
        await tx.gymEquipmentExercise.createMany({
          data: requestedIds.map((equipmentId) => ({
            equipmentId,
            exerciseId: id,
            mirrorsLegacyConfig: false,
          })),
        });
      }
      for (const gymId of new Set(ownedEquipment.map((item) => item.gymId))) {
        const requestedForGym = ownedEquipment
          .filter((item) => item.gymId === gymId && requestedIds.includes(item.id))
          .map((item) => item.id);
        await tx.gymExerciseConfig.updateMany({
          where: {
            gymId,
            exerciseId: id,
            preferredEquipmentId:
              requestedForGym.length > 0 ? { notIn: requestedForGym } : { not: null },
          },
          data: { preferredEquipmentId: null },
        });
        const systemBarIds = ownedEquipment
          .filter((item) => item.gymId === gymId && item.systemBarbellFamily != null)
          .map((item) => item.id);
        if (resolvedExerciseType === 'BARBELL' && systemBarIds.length > 0) {
          const supportsSystemProfile = systemBarIds.every((equipmentId) =>
            requestedIds.includes(equipmentId),
          );
          await tx.gymExerciseConfig.upsert({
            where: { gymId_exerciseId: { gymId, exerciseId: id } },
            update: { systemProfileSupported: supportsSystemProfile },
            create: {
              gymId,
              exerciseId: id,
              isAvailable: true,
              systemProfileSupported: supportsSystemProfile,
            },
          });
        }
        await reconcileLegacyExerciseConfigMirrors(tx, gymId, [id]);
      }
    });

    return NextResponse.json({ ok: true, equipmentIds: requestedIds });
  } catch (error) {
    return handleApiError(error);
  }
}
