import { describe, expect, it } from 'vitest';
import { sessionStartSchema, sessionUpdateSchema } from './session';

describe('sessionStartSchema', () => {
  it('accepts a programmed workoutId and rejects an empty workoutId', () => {
    expect(sessionStartSchema.parse({ workoutId: 'w1' }).workoutId).toBe('w1');
    expect(sessionStartSchema.safeParse({ workoutId: '' }).success).toBe(false);
  });

  it('accepts an empty object to start a free session', () => {
    expect(sessionStartSchema.safeParse({}).success).toBe(true);
  });
});

describe('sessionUpdateSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(sessionUpdateSchema.parse({})).toEqual({});
  });

  it('trims notes and accepts a finish flag', () => {
    expect(sessionUpdateSchema.parse({ notes: '  good  ', finish: true })).toEqual({
      notes: 'good',
      finish: true,
    });
  });

  it('rejects notes longer than 2000 characters', () => {
    expect(sessionUpdateSchema.safeParse({ notes: 'x'.repeat(2001) }).success).toBe(false);
  });
});
