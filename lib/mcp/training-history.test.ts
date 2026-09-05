import { describe, expect, it } from 'vitest';
import { serializeMcpTrainingSession, type McpTrainingHistorySession } from './training-history';

describe('MCP training history serialization', () => {
  it('keeps exact set, RIR and recorded-equipment facts without inventing missing values', () => {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      programId: 'program-1',
      workoutId: 'workout-1',
      gymId: 'gym-1',
      startedAt: new Date('2026-08-30T10:00:00Z'),
      finishedAt: new Date('2026-08-30T11:30:00Z'),
      notes: null,
      program: { id: 'program-1', name: 'Upper / Lower' },
      workout: { id: 'workout-1', name: 'Upper' },
      gym: { id: 'gym-1', name: 'X-Fit' },
      sets: [
        {
          id: 'set-1',
          sessionId: 'session-1',
          exerciseId: 'exercise-1',
          gymEquipmentId: 'equipment-1',
          equipmentNameSnapshot: 'Hammer row',
          equipmentLoadSnapshot: { version: 1, selectedLoadKg: 25 },
          setNumber: 1,
          weight: 25,
          reps: 10,
          rir: 1,
          durationSec: null,
          distanceM: null,
          avgHr: null,
          maxHr: null,
          track: null,
          notes: null,
          isWarmup: false,
          isDropSet: false,
          completedAt: new Date('2026-08-30T10:15:00Z'),
          exercise: {
            id: 'exercise-1',
            name: 'Machine Row',
            muscleGroup: 'BACK_THICKNESS',
            category: 'COMPOUND',
            equipmentType: 'MACHINE',
            usesBodyweight: false,
          },
          gymEquipment: { id: 'equipment-1', name: 'Hammer row', equipmentType: 'MACHINE' },
        },
        {
          id: 'set-2',
          sessionId: 'session-1',
          exerciseId: 'exercise-1',
          gymEquipmentId: null,
          equipmentNameSnapshot: null,
          equipmentLoadSnapshot: null,
          setNumber: 2,
          weight: 25,
          reps: 9,
          rir: null,
          durationSec: null,
          distanceM: null,
          avgHr: null,
          maxHr: null,
          track: null,
          notes: 'RIR was not recorded',
          isWarmup: false,
          isDropSet: false,
          completedAt: new Date('2026-08-30T10:20:00Z'),
          exercise: {
            id: 'exercise-1',
            name: 'Machine Row',
            muscleGroup: 'BACK_THICKNESS',
            category: 'COMPOUND',
            equipmentType: 'MACHINE',
            usesBodyweight: false,
          },
          gymEquipment: null,
        },
      ],
    } as unknown as McpTrainingHistorySession;

    const result = serializeMcpTrainingSession(session);

    expect(result).toMatchObject({
      sessionId: 'session-1',
      durationMin: 90,
      gym: { id: 'gym-1', name: 'X-Fit' },
      exercises: [
        {
          exerciseId: 'exercise-1',
          sets: [
            {
              setId: 'set-1',
              weightKg: 25,
              reps: 10,
              rir: 1,
              equipment: { id: 'equipment-1', name: 'Hammer row', equipmentType: 'MACHINE' },
            },
            {
              setId: 'set-2',
              rir: null,
              equipment: null,
            },
          ],
        },
      ],
    });
  });
});
