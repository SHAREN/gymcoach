import { describe, it, expect } from 'vitest';
import { MuscleGroup, ExerciseCategory } from '@/lib/prisma-client';
import { EXERCISE_CATALOG } from './exercise-catalog';
import { exerciseLoadProfileSchema } from '@/lib/schemas/exercise-load-profile';

describe('EXERCISE_CATALOG', () => {
  it('has unique exercise names', () => {
    const names = EXERCISE_CATALOG.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every entry has a name, a positive rest time, and a valid muscle group and category', () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(20);
    const groups = Object.values(MuscleGroup);
    const categories = Object.values(ExerciseCategory);
    for (const e of EXERCISE_CATALOG) {
      expect(e.name.trim().length).toBeGreaterThan(0);
      expect(e.defaultRestSec).toBeGreaterThan(0);
      expect(groups).toContain(e.muscleGroup);
      expect(categories).toContain(e.category);
      expect(exerciseLoadProfileSchema.safeParse(e.loadProfile).success).toBe(true);
      expect(['REVIEWED', 'UNCLASSIFIED']).toContain(e.loadProfile.classification);
    }
  });

  it('covers every muscle group at least once', () => {
    const covered = new Set(EXERCISE_CATALOG.map((e) => e.muscleGroup));
    for (const group of Object.values(MuscleGroup)) {
      // OTHER holds the cardio entries (issue #133) and the fallback bucket
      // for imported exercises (issue #100); coverage is asserted separately.
      if (group === 'OTHER') continue;
      expect(covered, `missing exercises for ${group}`).toContain(group);
    }
  });

  it('includes cardio entries, all grouped under OTHER (issue #133)', () => {
    const cardio = EXERCISE_CATALOG.filter((e) => e.category === ExerciseCategory.CARDIO);
    expect(cardio.length).toBeGreaterThanOrEqual(3);
    expect(cardio.map((e) => e.name)).toContain('Running');
    for (const e of cardio) {
      expect(e.muscleGroup).toBe(MuscleGroup.OTHER);
    }
    // And no non-cardio entry sits in the OTHER bucket.
    for (const e of EXERCISE_CATALOG) {
      if (e.muscleGroup === MuscleGroup.OTHER) {
        expect(e.category).toBe(ExerciseCategory.CARDIO);
      }
    }
  });

  it('maps core compound overlap, movement, lumbar, axial and joint tags', () => {
    const byName = new Map(EXERCISE_CATALOG.map((exercise) => [exercise.name, exercise]));
    const bench = byName.get('Barbell bench press')!.loadProfile;
    expect(bench.primaryMuscles.entries.map((entry) => entry.muscleGroup)).toContain('CHEST');
    expect(bench.secondaryMuscles.entries.map((entry) => entry.muscleGroup)).toEqual(
      expect.arrayContaining(['TRICEPS', 'SHOULDERS_FRONT']),
    );
    expect(bench.movementPatterns.entries.map((entry) => entry.value)).toContain('HORIZONTAL_PUSH');

    const pullup = byName.get('Pronated pull-ups (weighted if possible)')!.loadProfile;
    expect(pullup.secondaryMuscles.entries.map((entry) => entry.muscleGroup)).toContain('BICEPS');
    expect(pullup.movementPatterns.entries.map((entry) => entry.value)).toContain('VERTICAL_PULL');

    const overhead = byName.get('Standing barbell overhead press')!.loadProfile;
    expect(overhead.movementPatterns.entries.map((entry) => entry.value)).toContain(
      'VERTICAL_PUSH',
    );
    expect(overhead.fatigueTags.entries.map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['AXIAL_LOAD', 'LUMBAR_ISOMETRIC']),
    );

    const squat = byName.get('Machine squat (or Hack squat)')!.loadProfile;
    expect(squat.movementPatterns.entries.map((entry) => entry.value)).toContain(
      'SQUAT_KNEE_DOMINANT',
    );
    expect(squat.jointStress.entries.map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['HIP', 'KNEE', 'LUMBAR_SPINE']),
    );

    const hinge = byName.get('Dumbbell Romanian Deadlift')!.loadProfile;
    expect(hinge.movementPatterns.entries.map((entry) => entry.value)).toContain('HIP_HINGE');
    expect(hinge.fatigueTags.entries.map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['AXIAL_LOAD', 'LUMBAR_ISOMETRIC']),
    );

    const row = byName.get('Bent-over barbell row')!.loadProfile;
    expect(row.movementPatterns.entries.map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['HORIZONTAL_PULL', 'ROW', 'HIP_HINGE']),
    );
    expect(row.jointStress.entries.map((entry) => entry.value)).toContain('LUMBAR_SPINE');
  });
});
