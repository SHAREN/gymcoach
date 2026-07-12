import { describe, expect, it } from 'vitest';
import { gymCreateSchema, gymWeightUpdateSchema } from '@/lib/schemas/gym';

describe('gym schemas', () => {
  it('normalizes duplicate and unsorted inventory values', () => {
    const parsed = gymCreateSchema.parse({
      name: ' Basement ',
      dumbbellWeights: [19, 10, 12, 12, 16],
    });
    expect(parsed.name).toBe('Basement');
    expect(parsed.dumbbellWeights).toEqual([10, 12, 16, 19]);
    expect(parsed.plateWeights).toEqual([]);
  });

  it('normalizes partial weight-editor updates', () => {
    const parsed = gymWeightUpdateSchema.parse({
      exerciseId: 'exercise-1',
      scope: 'exercise',
      dumbbellWeights: [15.5, 10, 15.5],
    });
    expect(parsed.dumbbellWeights).toEqual([10, 15.5]);
    expect(parsed.barWeights).toEqual([]);
    expect(parsed.plateWeights).toEqual([]);
    expect(parsed.weightOptions).toEqual([]);
  });

  it('rejects non-positive inventory values', () => {
    expect(gymCreateSchema.safeParse({ name: 'Gym', dumbbellWeights: [0] }).success).toBe(false);
  });
});
