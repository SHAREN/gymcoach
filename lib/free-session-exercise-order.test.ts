import { describe, expect, it } from 'vitest';
import { orderFreeExerciseChoices } from './free-session-exercise-order';

describe('orderFreeExerciseChoices', () => {
  it('puts exercises with any workout history before untouched exercises', () => {
    const items = [
      { id: 'new-a', sessionCount: 0 },
      { id: 'used-a', sessionCount: 1 },
      { id: 'used-b', sessionCount: 8 },
      { id: 'new-b', sessionCount: 0 },
    ];

    expect(orderFreeExerciseChoices(items).map((item) => item.id)).toEqual([
      'used-a',
      'used-b',
      'new-a',
      'new-b',
    ]);
  });

  it('keeps the existing catalog order inside the used and unused groups', () => {
    const items = [
      { id: 'used-first', sessionCount: 2 },
      { id: 'unused-first', sessionCount: 0 },
      { id: 'used-second', sessionCount: 20 },
      { id: 'unused-second', sessionCount: 0 },
    ];

    expect(orderFreeExerciseChoices(items).map((item) => item.id)).toEqual([
      'used-first',
      'used-second',
      'unused-first',
      'unused-second',
    ]);
  });
});
