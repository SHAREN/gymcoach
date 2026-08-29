import { ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import {
  decodeGymEquipmentImage,
  GYM_EQUIPMENT_IMAGE_MIME_TYPES,
  type GymEquipmentImageMimeType,
} from '@/lib/gym-equipment';
import type { EquipmentType, Prisma } from '@/lib/prisma-client';

export type EquipmentImageScope = 'GYM_EQUIPMENT' | 'TEMPLATE';

export interface EquipmentImageTarget {
  scope: EquipmentImageScope;
  targetId: string;
}

export interface AddEquipmentImageInput {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: GymEquipmentImageMimeType;
  makePrimary?: boolean;
  sourceNote?: string | null;
}

export interface UpsertEquipmentTemplateInput {
  templateId?: string;
  name: string;
  equipmentType: EquipmentType;
  description?: string | null;
  manufacturer?: string | null;
  modelName?: string | null;
}

type ImageRow = {
  id: string;
  imageUrl: string | null;
  imageData: Uint8Array | null;
  imageMimeType: string | null;
  isPrimary: boolean;
  sourceMeta: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

function validateImageInput(input: AddEquipmentImageInput) {
  const modes = [input.imageUrl != null, input.imageBase64 != null].filter(Boolean).length;
  if (modes !== 1) throw new ApiError(400, 'Choose exactly one image source.');
  if (input.imageUrl && !input.imageUrl.startsWith('https://')) {
    throw new ApiError(400, 'External equipment images must use HTTPS.');
  }
  if (input.sourceNote != null && input.sourceNote.length > 500) {
    throw new ApiError(400, 'Image source note is too long.');
  }
}

function imageData(input: AddEquipmentImageInput) {
  validateImageInput(input);
  const sourceMeta = input.sourceNote ? { sourceNote: input.sourceNote } : undefined;
  if (input.imageUrl) {
    return {
      imageUrl: input.imageUrl,
      imageData: null,
      imageMimeType: null,
      sourceMeta,
    };
  }
  const decoded = decodeGymEquipmentImage(input.imageBase64!, input.mimeType);
  return {
    imageUrl: null,
    imageData: decoded.bytes,
    imageMimeType: decoded.mimeType,
    sourceMeta,
  };
}

function imageSummary(row: Omit<ImageRow, 'imageData'> & { imageData?: Uint8Array | null }) {
  return {
    id: row.id,
    kind: row.imageMimeType ? ('uploaded' as const) : ('external' as const),
    imageUrl: row.imageUrl,
    mimeType: row.imageMimeType,
    isPrimary: row.isPrimary,
    sourceMeta: row.sourceMeta,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function imageContent(row: ImageRow) {
  if (row.imageData && row.imageMimeType) {
    if (!GYM_EQUIPMENT_IMAGE_MIME_TYPES.includes(row.imageMimeType as GymEquipmentImageMimeType)) {
      throw new ApiError(500, 'Stored equipment image has an unsupported MIME type.');
    }
    return {
      ...imageSummary(row),
      kind: 'uploaded' as const,
      data: Buffer.from(row.imageData).toString('base64'),
      mimeType: row.imageMimeType as GymEquipmentImageMimeType,
    };
  }
  if (row.imageUrl) return { ...imageSummary(row), kind: 'external' as const, url: row.imageUrl };
  throw new ApiError(404, 'Equipment image content not found.');
}

export async function listOwnedEquipmentTemplates(userId: string) {
  return db.equipmentTemplate.findMany({
    where: { userId },
    orderBy: [{ manufacturer: 'asc' }, { modelName: 'asc' }, { name: 'asc' }],
    include: {
      images: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      _count: { select: { equipment: true } },
    },
  });
}

export async function upsertOwnedEquipmentTemplate(userId: string, input: UpsertEquipmentTemplateInput) {
  if (input.templateId) {
    const existing = await db.equipmentTemplate.findFirst({ where: { id: input.templateId, userId } });
    if (!existing) throw new ApiError(404, 'Equipment template not found.');
    if (input.equipmentType !== existing.equipmentType) {
      const incompatibleLinkedEquipment = await db.gymEquipment.findFirst({
        where: {
          templateId: existing.id,
          equipmentType: { not: input.equipmentType },
          gym: { userId },
        },
        select: { id: true },
      });
      if (incompatibleLinkedEquipment) {
        throw new ApiError(
          400,
          'Equipment template type cannot change while incompatible concrete equipment is linked.',
        );
      }
    }
    return db.equipmentTemplate.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        equipmentType: input.equipmentType,
        description: input.description,
        manufacturer: input.manufacturer,
        modelName: input.modelName,
      },
    });
  }
  return db.equipmentTemplate.create({
    data: {
      userId,
      name: input.name,
      equipmentType: input.equipmentType,
      description: input.description,
      manufacturer: input.manufacturer,
      modelName: input.modelName,
    },
  });
}

export async function deleteOwnedEquipmentTemplate(userId: string, templateId: string) {
  const template = await db.equipmentTemplate.findFirst({ where: { id: templateId, userId } });
  if (!template) return { ok: true, deleted: false };
  await db.equipmentTemplate.delete({ where: { id: template.id } });
  return { ok: true, deleted: true };
}

export async function setOwnedGymEquipmentTemplate(
  userId: string,
  equipmentId: string,
  templateId: string | null,
) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: { id: true, equipmentType: true },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
  if (templateId) {
    const template = await db.equipmentTemplate.findFirst({ where: { id: templateId, userId } });
    if (!template) throw new ApiError(404, 'Equipment template not found.');
    if (template.equipmentType !== equipment.equipmentType) {
      throw new ApiError(400, 'Equipment template type must match the concrete equipment type.');
    }
  }
  return db.gymEquipment.update({
    where: { id: equipment.id },
    data: { templateId },
    select: { id: true, gymId: true, name: true, equipmentType: true, templateId: true },
  });
}

async function ownedTarget(userId: string, target: EquipmentImageTarget) {
  if (target.scope === 'GYM_EQUIPMENT') {
    const equipment = await db.gymEquipment.findFirst({
      where: { id: target.targetId, gym: { userId } },
      select: { id: true, gymId: true, name: true, templateId: true },
    });
    if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
    return { scope: 'GYM_EQUIPMENT' as const, equipment };
  }
  const template = await db.equipmentTemplate.findFirst({
    where: { id: target.targetId, userId },
    select: { id: true, name: true },
  });
  if (!template) throw new ApiError(404, 'Equipment template not found.');
  return { scope: 'TEMPLATE' as const, template };
}

export async function listOwnedEquipmentImages(userId: string, target: EquipmentImageTarget) {
  const owned = await ownedTarget(userId, target);
  const rows =
    owned.scope === 'GYM_EQUIPMENT'
      ? await db.gymEquipmentImage.findMany({
          where: { equipmentId: owned.equipment.id },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            imageUrl: true,
            imageMimeType: true,
            isPrimary: true,
            sourceMeta: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      : await db.equipmentTemplateImage.findMany({
          where: { templateId: owned.template.id },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            imageUrl: true,
            imageMimeType: true,
            isPrimary: true,
            sourceMeta: true,
            createdAt: true,
            updatedAt: true,
          },
        });
  return { target, images: rows.map(imageSummary) };
}

export async function getOwnedEquipmentImage(
  userId: string,
  target: EquipmentImageTarget,
  imageId: string,
) {
  const owned = await ownedTarget(userId, target);
  const row =
    owned.scope === 'GYM_EQUIPMENT'
      ? await db.gymEquipmentImage.findFirst({ where: { id: imageId, equipmentId: owned.equipment.id } })
      : await db.equipmentTemplateImage.findFirst({ where: { id: imageId, templateId: owned.template.id } });
  if (!row) throw new ApiError(404, 'Equipment image not found.');
  return { target, image: imageContent(row) };
}

export async function addOwnedEquipmentImage(
  userId: string,
  target: EquipmentImageTarget,
  input: AddEquipmentImageInput,
) {
  const owned = await ownedTarget(userId, target);
  const data = imageData(input);
  return db.$transaction(async (tx) => {
    if (owned.scope === 'GYM_EQUIPMENT') {
      const count = await tx.gymEquipmentImage.count({ where: { equipmentId: owned.equipment.id } });
      const makePrimary = input.makePrimary ?? count === 0;
      if (makePrimary) {
        await tx.gymEquipmentImage.updateMany({
          where: { equipmentId: owned.equipment.id },
          data: { isPrimary: false },
        });
      }
      const image = await tx.gymEquipmentImage.create({
        data: { equipmentId: owned.equipment.id, ...data, isPrimary: makePrimary },
      });
      if (makePrimary) await syncLegacyConcretePrimary(tx, owned.equipment.id, image);
      return { target, image: imageSummary(image) };
    }
    const count = await tx.equipmentTemplateImage.count({ where: { templateId: owned.template.id } });
    const makePrimary = input.makePrimary ?? count === 0;
    if (makePrimary) {
      await tx.equipmentTemplateImage.updateMany({
        where: { templateId: owned.template.id },
        data: { isPrimary: false },
      });
    }
    const image = await tx.equipmentTemplateImage.create({
      data: { templateId: owned.template.id, ...data, isPrimary: makePrimary },
    });
    return { target, image: imageSummary(image) };
  });
}

export async function setPrimaryOwnedEquipmentImage(
  userId: string,
  target: EquipmentImageTarget,
  imageId: string,
) {
  const owned = await ownedTarget(userId, target);
  return db.$transaction(async (tx) => {
    if (owned.scope === 'GYM_EQUIPMENT') {
      const image = await tx.gymEquipmentImage.findFirst({
        where: { id: imageId, equipmentId: owned.equipment.id },
      });
      if (!image) throw new ApiError(404, 'Equipment image not found.');
      await tx.gymEquipmentImage.updateMany({
        where: { equipmentId: owned.equipment.id },
        data: { isPrimary: false },
      });
      const primary = await tx.gymEquipmentImage.update({ where: { id: image.id }, data: { isPrimary: true } });
      await syncLegacyConcretePrimary(tx, owned.equipment.id, primary);
      return { target, image: imageSummary(primary) };
    }
    const image = await tx.equipmentTemplateImage.findFirst({
      where: { id: imageId, templateId: owned.template.id },
    });
    if (!image) throw new ApiError(404, 'Equipment image not found.');
    await tx.equipmentTemplateImage.updateMany({
      where: { templateId: owned.template.id },
      data: { isPrimary: false },
    });
    const primary = await tx.equipmentTemplateImage.update({ where: { id: image.id }, data: { isPrimary: true } });
    return { target, image: imageSummary(primary) };
  });
}

export async function deleteOwnedEquipmentImage(
  userId: string,
  target: EquipmentImageTarget,
  imageId: string,
) {
  const owned = await ownedTarget(userId, target);
  return db.$transaction(async (tx) => {
    if (owned.scope === 'GYM_EQUIPMENT') {
      const image = await tx.gymEquipmentImage.findFirst({
        where: { id: imageId, equipmentId: owned.equipment.id },
      });
      if (!image) return { ok: true, deleted: false, target };
      await tx.gymEquipmentImage.delete({ where: { id: image.id } });
      if (image.isPrimary) {
        const replacement = await tx.gymEquipmentImage.findFirst({
          where: { equipmentId: owned.equipment.id },
          orderBy: { createdAt: 'asc' },
        });
        if (replacement) {
          const primary = await tx.gymEquipmentImage.update({
            where: { id: replacement.id },
            data: { isPrimary: true },
          });
          await syncLegacyConcretePrimary(tx, owned.equipment.id, primary);
        } else {
          await tx.gymEquipment.update({
            where: { id: owned.equipment.id },
            data: { imageUrl: null, imageData: null, imageMimeType: null },
          });
        }
      }
      return { ok: true, deleted: true, target };
    }
    const image = await tx.equipmentTemplateImage.findFirst({
      where: { id: imageId, templateId: owned.template.id },
    });
    if (!image) return { ok: true, deleted: false, target };
    await tx.equipmentTemplateImage.delete({ where: { id: image.id } });
    if (image.isPrimary) {
      const replacement = await tx.equipmentTemplateImage.findFirst({
        where: { templateId: owned.template.id },
        orderBy: { createdAt: 'asc' },
      });
      if (replacement) {
        await tx.equipmentTemplateImage.update({
          where: { id: replacement.id },
          data: { isPrimary: true },
        });
      }
    }
    return { ok: true, deleted: true, target };
  });
}

export async function getEffectiveOwnedGymEquipmentImage(userId: string, equipmentId: string) {
  const equipment = await db.gymEquipment.findFirst({
    where: { id: equipmentId, gym: { userId } },
    select: {
      id: true,
      gymId: true,
      name: true,
      templateId: true,
      imageUrl: true,
      imageData: true,
      imageMimeType: true,
      updatedAt: true,
      images: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
      template: {
        select: {
          id: true,
          name: true,
          images: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
        },
      },
    },
  });
  if (!equipment) throw new ApiError(404, 'Gym equipment not found.');
  const gymImage = equipment.images[0];
  if (gymImage) {
    return {
      equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
      source: 'GYM_EQUIPMENT' as const,
      image: imageContent(gymImage),
    };
  }
  const templateImage = equipment.template?.images[0];
  if (templateImage) {
    return {
      equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
      source: 'TEMPLATE' as const,
      template: equipment.template ? { id: equipment.template.id, name: equipment.template.name } : null,
      image: imageContent(templateImage),
    };
  }
  if (equipment.imageData && equipment.imageMimeType) {
    return {
      equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
      source: 'LEGACY_GYM_EQUIPMENT' as const,
      image: imageContent({
        id: `legacy_${equipment.id}`,
        imageUrl: equipment.imageUrl,
        imageData: equipment.imageData,
        imageMimeType: equipment.imageMimeType,
        isPrimary: true,
        sourceMeta: { origin: 'legacy-single-image' },
        createdAt: equipment.updatedAt,
        updatedAt: equipment.updatedAt,
      }),
    };
  }
  if (equipment.imageUrl) {
    return {
      equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
      source: 'LEGACY_GYM_EQUIPMENT' as const,
      image: imageContent({
        id: `legacy_${equipment.id}`,
        imageUrl: equipment.imageUrl,
        imageData: null,
        imageMimeType: null,
        isPrimary: true,
        sourceMeta: { origin: 'legacy-single-image' },
        createdAt: equipment.updatedAt,
        updatedAt: equipment.updatedAt,
      }),
    };
  }
  return {
    equipment: { id: equipment.id, gymId: equipment.gymId, name: equipment.name },
    source: 'PLACEHOLDER' as const,
    image: null,
  };
}

async function syncLegacyConcretePrimary(
  tx: Prisma.TransactionClient,
  equipmentId: string,
  image: { imageUrl: string | null; imageData: Uint8Array<ArrayBuffer> | null; imageMimeType: string | null },
) {
  await tx.gymEquipment.update({
    where: { id: equipmentId },
    data: {
      imageUrl: image.imageUrl,
      imageData: image.imageData,
      imageMimeType: image.imageMimeType,
    },
  });
}
