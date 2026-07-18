import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumeSessionDetailReturnState,
  saveSessionDetailReturnState,
  type SessionDetailReturnState,
} from './session-detail-return-state';

const now = new Date('2026-07-18T12:00:00Z').getTime();

function snapshot(overrides: Partial<SessionDetailReturnState> = {}): SessionDetailReturnState {
  return {
    version: 1,
    sessionId: 'session-1',
    savedAt: now,
    selectedEquipmentByExercise: { 'exercise-1': 'equipment-1' },
    targetSetOverrides: { 'program-exercise-1': 3 },
    strengthDraftsByExercise: {
      'exercise-1': { weight: 20, reps: 10, rir: 2 },
    },
    cardioDraftsByExercise: {},
    mode: {
      kind: 'rest',
      endsAt: now + 90_000,
      totalSec: 90,
      nextExerciseIdx: null,
      navigatedImmediately: false,
    },
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('session detail return state', () => {
  it('restores the exact bounded snapshot once', () => {
    const state = snapshot();
    saveSessionDetailReturnState(state);

    expect(consumeSessionDetailReturnState(state.sessionId, now)).toEqual(state);
    expect(consumeSessionDetailReturnState(state.sessionId, now)).toBeNull();
  });

  it('rejects stale, future, mismatched and malformed snapshots', () => {
    saveSessionDetailReturnState(snapshot({ savedAt: now - 31 * 60_000 }));
    expect(consumeSessionDetailReturnState('session-1', now)).toBeNull();

    saveSessionDetailReturnState(snapshot({ savedAt: now + 61_000 }));
    expect(consumeSessionDetailReturnState('session-1', now)).toBeNull();

    saveSessionDetailReturnState(snapshot());
    expect(consumeSessionDetailReturnState('session-2', now)).toBeNull();

    window.sessionStorage.setItem(
      'gymcoach:session-detail-return:v1:session-1',
      JSON.stringify({ version: 1, sessionId: 'session-1', savedAt: now }),
    );
    expect(consumeSessionDetailReturnState('session-1', now)).toBeNull();
  });
});
