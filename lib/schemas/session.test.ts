import { describe, it, expect } from 'vitest';
import { sessionStartSchema, sessionUpdateSchema } from './session';

describe('sessionStartSchema', () => {
  it('requires a non-empty workoutId for programmed sessions', () => {
    const parsed = sessionStartSchema.parse({ workoutId: 'w1' });
    expect('workoutId' in parsed ? parsed.workoutId : null).toBe('w1');
    expect(sessionStartSchema.safeParse({ workoutId: '' }).success).toBe(false);
    expect(sessionStartSchema.safeParse({}).success).toBe(false);
  });

  it('accepts an explicit freeform session without a workoutId', () => {
    expect(sessionStartSchema.parse({ freeform: true })).toEqual({ freeform: true });
    expect(sessionStartSchema.safeParse({ freeform: false }).success).toBe(false);
  });
});

describe('sessionUpdateSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(sessionUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('trims notes and accepts a finish flag', () => {
    const parsed = sessionUpdateSchema.parse({ notes: '  good session  ', finish: true });
    expect(parsed.notes).toBe('good session');
    expect(parsed.finish).toBe(true);
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(sessionUpdateSchema.safeParse({ notes: 'x'.repeat(2001) }).success).toBe(false);
  });
});
