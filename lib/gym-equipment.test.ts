import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { MAX_GYM_EQUIPMENT_IMAGE_BYTES, decodeGymEquipmentImage } from './gym-equipment';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('decodeGymEquipmentImage', () => {
  it.each([
    ['image/jpeg', JPEG],
    ['image/png', PNG],
    ['image/webp', WEBP],
  ] as const)('accepts a valid %s upload', (mimeType, bytes) => {
    const decoded = decodeGymEquipmentImage(bytes.toString('base64'), mimeType);

    expect(decoded.mimeType).toBe(mimeType);
    expect(Buffer.from(decoded.bytes)).toEqual(bytes);
    expect(decoded.bytes.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('infers the MIME type from a data URL', () => {
    const decoded = decodeGymEquipmentImage(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(decoded.mimeType).toBe('image/png');
  });

  it('rejects a declared MIME type that differs from the data URL', () => {
    expect(() =>
      decodeGymEquipmentImage(`data:image/png;base64,${PNG.toString('base64')}`, 'image/jpeg'),
    ).toThrow('does not match');
  });

  it('rejects malformed base64 and mismatched file signatures', () => {
    expect(() => decodeGymEquipmentImage('@@@', 'image/png')).toThrow('Invalid base64');
    expect(() => decodeGymEquipmentImage(JPEG.toString('base64'), 'image/png')).toThrow(
      'do not match',
    );
  });

  it('rejects oversized uploads before decoding them', () => {
    const oversized = 'A'.repeat(Math.ceil((MAX_GYM_EQUIPMENT_IMAGE_BYTES * 4) / 3) + 32);
    expect(() => decodeGymEquipmentImage(oversized, 'image/jpeg')).toThrow('larger than 5 MB');
  });
});
