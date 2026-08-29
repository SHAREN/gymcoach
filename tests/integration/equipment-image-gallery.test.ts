import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  addOwnedEquipmentImage,
  deleteOwnedEquipmentImage,
  getEffectiveOwnedGymEquipmentImage,
  listOwnedEquipmentImages,
  setOwnedGymEquipmentTemplate,
  setPrimaryOwnedEquipmentImage,
  upsertOwnedEquipmentTemplate,
} from '@/lib/equipment-image-gallery';
import { setOwnedGymEquipmentImage } from '@/lib/gym-equipment';

describe('equipment image galleries', () => {
  it('falls back from concrete gym media to canonical template media and preserves ownership', async () => {
    const owner = await db.user.create({
      data: { email: 'gallery-owner@test.dev', passwordHash: 'x' },
    });
    const stranger = await db.user.create({
      data: { email: 'gallery-stranger@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'X-Fit' } });
    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Pec deck #2', equipmentType: 'MACHINE' },
    });

    const template = await upsertOwnedEquipmentTemplate(owner.id, {
      name: 'Pec Deck / Butterfly',
      equipmentType: 'MACHINE',
      manufacturer: 'Generic',
    });
    const templateImage = await addOwnedEquipmentImage(
      owner.id,
      { scope: 'TEMPLATE', targetId: template.id },
      { imageUrl: 'https://example.com/pec-deck-template.jpg', sourceNote: 'canonical source' },
    );
    expect(templateImage.image.isPrimary).toBe(true);

    await setOwnedGymEquipmentTemplate(owner.id, equipment.id, template.id);
    const fallback = await getEffectiveOwnedGymEquipmentImage(owner.id, equipment.id);
    expect(fallback.source).toBe('TEMPLATE');
    expect(fallback.image).toMatchObject({
      kind: 'external',
      url: 'https://example.com/pec-deck-template.jpg',
    });

    await expect(
      listOwnedEquipmentImages(stranger.id, { scope: 'TEMPLATE', targetId: template.id }),
    ).rejects.toThrow('Equipment template not found.');
  });

  it('keeps gym-specific primary independent and promotes a replacement when deleted', async () => {
    const owner = await db.user.create({
      data: { email: 'gallery-primary@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'Olymp' } });
    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Smith A', equipmentType: 'BARBELL' },
    });

    const first = await addOwnedEquipmentImage(
      owner.id,
      { scope: 'GYM_EQUIPMENT', targetId: equipment.id },
      { imageUrl: 'https://example.com/smith-a.jpg' },
    );
    const second = await addOwnedEquipmentImage(
      owner.id,
      { scope: 'GYM_EQUIPMENT', targetId: equipment.id },
      { imageUrl: 'https://example.com/smith-b.jpg' },
    );
    expect(first.image.isPrimary).toBe(true);
    expect(second.image.isPrimary).toBe(false);

    await setPrimaryOwnedEquipmentImage(
      owner.id,
      { scope: 'GYM_EQUIPMENT', targetId: equipment.id },
      second.image.id,
    );
    let effective = await getEffectiveOwnedGymEquipmentImage(owner.id, equipment.id);
    expect(effective.source).toBe('GYM_EQUIPMENT');
    expect(effective.image).toMatchObject({ url: 'https://example.com/smith-b.jpg', isPrimary: true });

    await deleteOwnedEquipmentImage(
      owner.id,
      { scope: 'GYM_EQUIPMENT', targetId: equipment.id },
      second.image.id,
    );
    effective = await getEffectiveOwnedGymEquipmentImage(owner.id, equipment.id);
    expect(effective.image).toMatchObject({ url: 'https://example.com/smith-a.jpg', isPrimary: true });

    const stored = await db.gymEquipment.findUniqueOrThrow({ where: { id: equipment.id } });
    expect(stored.imageUrl).toBe('https://example.com/smith-a.jpg');
  });

  it('keeps the legacy single-image write path synchronized with the new gallery', async () => {
    const owner = await db.user.create({
      data: { email: 'gallery-legacy@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'Legacy gym' } });
    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Cable station', equipmentType: 'CABLE' },
    });

    await addOwnedEquipmentImage(
      owner.id,
      { scope: 'GYM_EQUIPMENT', targetId: equipment.id },
      { imageUrl: 'https://example.com/old.jpg' },
    );
    await setOwnedGymEquipmentImage(owner.id, equipment.id, {
      imageUrl: 'https://example.com/replaced.jpg',
    });

    const gallery = await listOwnedEquipmentImages(owner.id, {
      scope: 'GYM_EQUIPMENT',
      targetId: equipment.id,
    });
    expect(gallery.images).toHaveLength(1);
    expect(gallery.images[0]).toMatchObject({
      imageUrl: 'https://example.com/replaced.jpg',
      isPrimary: true,
    });
  });

  it('rejects changing a template type while incompatible concrete equipment is linked', async () => {
    const owner = await db.user.create({
      data: { email: 'gallery-template-type@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'Template type gym' } });
    const equipment = await db.gymEquipment.create({
      data: { gymId: gym.id, name: 'Pec deck', equipmentType: 'MACHINE' },
    });
    const template = await upsertOwnedEquipmentTemplate(owner.id, {
      name: 'Pec Deck',
      equipmentType: 'MACHINE',
    });
    await setOwnedGymEquipmentTemplate(owner.id, equipment.id, template.id);

    await expect(
      upsertOwnedEquipmentTemplate(owner.id, {
        templateId: template.id,
        name: 'Pec Deck',
        equipmentType: 'CABLE',
      }),
    ).rejects.toThrow(
      'Equipment template type cannot change while incompatible concrete equipment is linked.',
    );

    const unchanged = await db.equipmentTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(unchanged.equipmentType).toBe('MACHINE');
  });
});
