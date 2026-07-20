import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { seedExerciseCatalog } from '@/lib/exercise-catalog';
import { reviewedExerciseLoadProfile } from '@/lib/schemas/exercise-load-profile';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

import { POST as createProgramFromTemplate } from '@/app/api/programs/from-template/route';

function request(body: unknown): Request {
  return new Request('http://test.local/api/programs/from-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockUserId.mockReset();
});

describe('POST /api/programs/from-template provenance', () => {
  it('preserves unchanged catalog metadata and resets changed or mismatched identities', async () => {
    const user = await db.user.create({
      data: { email: 'template-provenance@test.dev', passwordHash: 'x' },
    });
    await seedExerciseCatalog(db, user.id);
    const benchBefore = await db.exercise.findUniqueOrThrow({
      where: { userId_name: { userId: user.id, name: 'Barbell bench press' } },
    });
    const staleRomanianDeadlift = await db.exercise.create({
      data: {
        userId: user.id,
        name: 'Romanian Deadlift',
        muscleGroup: 'HAMSTRINGS',
        category: 'COMPOUND',
        defaultRestSec: 120,
        notes: null,
        usesBodyweight: false,
        equipmentType: 'BARBELL',
        catalogOrigin: 'SYSTEM_DEFAULT_V1',
        loadProfile: reviewedExerciseLoadProfile({
          primaryMuscles: ['HAMSTRINGS'],
          secondaryMuscles: ['GLUTES', 'LOWER_BACK'],
          movementPatterns: ['HIP_HINGE'],
          fatigueTags: ['AXIAL_LOAD', 'LUMBAR_ISOMETRIC'],
          jointStress: ['HIP', 'LUMBAR_SPINE'],
        }),
      },
    });
    mockUserId.mockResolvedValue(user.id);

    const response = await createProgramFromTemplate(
      request({
        name: 'Provenance template',
        phase: 'Test',
        workouts: [
          {
            name: 'Full body',
            exercises: [
              {
                name: benchBefore.name,
                muscleGroup: benchBefore.muscleGroup,
                category: benchBefore.category,
                equipmentType: benchBefore.equipmentType,
                targetSets: 3,
                targetRepsMin: 6,
                targetRepsMax: 10,
                targetRIR: 2,
                restSec: benchBefore.defaultRestSec,
                notes: benchBefore.notes,
              },
              {
                name: staleRomanianDeadlift.name,
                muscleGroup: 'QUADS',
                category: 'ISOLATION',
                equipmentType: 'DUMBBELL',
                targetSets: 3,
                targetRepsMin: 10,
                targetRepsMax: 15,
                targetRIR: 2,
                restSec: 60,
                notes: 'Reclassified custom movement.',
              },
              {
                name: 'Deadlift',
                muscleGroup: 'CHEST',
                category: 'ISOLATION',
                equipmentType: 'MACHINE',
                targetSets: 3,
                targetRepsMin: 10,
                targetRepsMax: 15,
                targetRIR: 2,
                restSec: 60,
              },
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(201);

    const benchAfter = await db.exercise.findUniqueOrThrow({
      where: { id: benchBefore.id },
    });
    expect(benchAfter).toMatchObject({
      catalogOrigin: 'SYSTEM_DEFAULT_V1',
      loadProfile: { classification: 'REVIEWED', provenance: 'SYSTEM_CATALOG_REVIEW' },
    });

    const romanianDeadliftAfter = await db.exercise.findUniqueOrThrow({
      where: { id: staleRomanianDeadlift.id },
    });
    expect(romanianDeadliftAfter).toMatchObject({
      muscleGroup: 'QUADS',
      category: 'ISOLATION',
      equipmentType: 'DUMBBELL',
      catalogOrigin: null,
      loadProfile: {
        classification: 'UNCLASSIFIED',
        provenance: 'UNCLASSIFIED',
        secondaryMuscles: { state: 'UNKNOWN', entries: [] },
      },
    });

    expect(
      await db.exercise.findUniqueOrThrow({
        where: { userId_name: { userId: user.id, name: 'Deadlift' } },
      }),
    ).toMatchObject({
      muscleGroup: 'CHEST',
      category: 'ISOLATION',
      catalogOrigin: null,
      loadProfile: { classification: 'UNCLASSIFIED', provenance: 'UNCLASSIFIED' },
    });
  });
});
