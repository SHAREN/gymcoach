import { describe, expect, it } from 'vitest';
import { initialSessionExerciseIndex, safeSessionReturnTo } from '@/lib/session-navigation';

describe('session navigation', () => {
  it('restores the requested program exercise and safely falls back to the first', () => {
    const exercises = [{ id: 'pe-1' }, { id: 'pe-2' }, { id: 'pe-3' }];
    expect(initialSessionExerciseIndex(exercises, 'pe-2')).toBe(1);
    expect(initialSessionExerciseIndex(exercises, 'missing')).toBe(0);
    expect(initialSessionExerciseIndex(exercises, null)).toBe(0);
  });

  it('allows only an internal session return path', () => {
    expect(safeSessionReturnTo('/session/s1?programExerciseId=pe-2')).toBe(
      '/session/s1?programExerciseId=pe-2',
    );
    expect(safeSessionReturnTo('/exercises')).toBe('/exercises');
    expect(safeSessionReturnTo('//evil.example/session/s1')).toBe('/exercises');
    expect(safeSessionReturnTo('https://evil.example/session/s1')).toBe('/exercises');
    expect(safeSessionReturnTo(['/session/s1'])).toBe('/exercises');
  });
});
