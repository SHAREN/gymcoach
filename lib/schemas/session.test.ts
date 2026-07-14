import { describe, it, expect } from 'vitest';
import { sessionStartSchema, sessionUpdateSchema } from './session';

describe('sessionStartSchema', () => {
  it('requires a non-empty workoutId', () => {
    expect(sessionStartSchema.parse({ workoutId: 'w1' }).workoutId).toBe('w1');
    expect(sessionStartSchema.safeParse({ workoutId: '' }).success).toBe(false);
    expect(sessionStartSchema.safeParse({}).success).toBe(false);
  });
});

describe('sessionUpdateSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(sessionUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('trims notes and accepts finish-time overflow ids', () => {
    const parsed = sessionUpdateSchema.parse({
      notes: '  good session  ',
      finish: true,
      discardSetIds: ['set-4'],
    });
    expect(parsed.notes).toBe('good session');
    expect(parsed.finish).toBe(true);
    expect(parsed.discardSetIds).toEqual(['set-4']);
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(sessionUpdateSchema.safeParse({ notes: 'x'.repeat(2001) }).success).toBe(false);
  });
});
