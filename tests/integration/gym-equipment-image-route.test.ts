import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { GET } from '@/app/api/gym-equipment/[id]/image/route';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
  mockUserId.mockReset();
});

describe('GET /api/gym-equipment/:id/image', () => {
  it('serves an owned uploaded image with private cache headers', async () => {
    const user = await db.user.create({
      data: { email: 'equipment-image-owner@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: user.id, name: 'Olymp' } });
    const bytes = new Uint8Array(new ArrayBuffer(PNG.length));
    bytes.set(PNG);
    const equipment = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Chest press',
        equipmentType: 'MACHINE',
        imageData: bytes,
        imageMimeType: 'image/png',
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await GET(
      new Request(`http://test.local/api/gym-equipment/${equipment.id}/image`),
      { params: Promise.resolve({ id: equipment.id }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
  });

  it('does not expose an image owned by another user', async () => {
    const owner = await db.user.create({
      data: { email: 'equipment-image-a@test.dev', passwordHash: 'x' },
    });
    const stranger = await db.user.create({
      data: { email: 'equipment-image-b@test.dev', passwordHash: 'x' },
    });
    const gym = await db.gym.create({ data: { userId: owner.id, name: 'Private gym' } });
    const bytes = new Uint8Array(new ArrayBuffer(PNG.length));
    bytes.set(PNG);
    const equipment = await db.gymEquipment.create({
      data: {
        gymId: gym.id,
        name: 'Private machine',
        equipmentType: 'MACHINE',
        imageData: bytes,
        imageMimeType: 'image/png',
      },
    });
    mockUserId.mockResolvedValue(stranger.id);

    const response = await GET(
      new Request(`http://test.local/api/gym-equipment/${equipment.id}/image`),
      { params: Promise.resolve({ id: equipment.id }) },
    );
    expect(response.status).toBe(404);
  });

  it('requires an authenticated web session', async () => {
    mockUserId.mockResolvedValue(null);
    const response = await GET(new Request('http://test.local/api/gym-equipment/missing/image'), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(response.status).toBe(401);
  });
});
