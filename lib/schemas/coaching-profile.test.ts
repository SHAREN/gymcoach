import { describe, expect, it } from 'vitest';
import {
  applyCoachingProfilePatch,
  coachingProfilePatchSchema,
  emptyCoachingProfile,
  normalizeCoachingProfile,
} from './coaching-profile';

describe('coaching profile schema', () => {
  it('keeps older rows explicitly unknown instead of assuming a healthy state', () => {
    const profile = normalizeCoachingProfile(null);

    expect(profile).toEqual(emptyCoachingProfile());
    expect(profile.healthStatus).toEqual({ state: 'UNKNOWN', value: null, updatedAt: null });
    expect(profile.limitations.state).toBe('UNKNOWN');
  });

  it('merges only patched fields and stamps them on the server', () => {
    const first = applyCoachingProfilePatch(
      null,
      coachingProfilePatchSchema.parse({
        healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
        limitations: {
          state: 'KNOWN',
          value: {
            entries: [
              {
                kind: 'PAIN',
                label: 'Pressing discomfort',
                affectedExerciseNames: ['Bench press'],
              },
            ],
          },
        },
      }),
      new Date('2026-07-18T10:00:00.000Z'),
    );
    const second = applyCoachingProfilePatch(
      first,
      coachingProfilePatchSchema.parse({
        availableWeekdays: { state: 'KNOWN', value: [5, 1, 3] },
      }),
      new Date('2026-07-18T11:00:00.000Z'),
    );

    expect(second.availableWeekdays).toEqual({
      state: 'KNOWN',
      value: [1, 3, 5],
      updatedAt: '2026-07-18T11:00:00.000Z',
    });
    expect(second.healthStatus.updatedAt).toBe('2026-07-18T10:00:00.000Z');
    expect(second.limitations.value?.entries[0]?.affectedExerciseNames).toEqual(['Bench press']);
  });

  it('distinguishes unknown from not applicable and enforces structured constraints', () => {
    expect(
      coachingProfilePatchSchema.parse({
        limitations: { state: 'NOT_APPLICABLE' },
        outsideActivities: { state: 'UNKNOWN' },
      }),
    ).toMatchObject({
      limitations: { state: 'NOT_APPLICABLE' },
      outsideActivities: { state: 'UNKNOWN' },
    });

    expect(
      coachingProfilePatchSchema.safeParse({
        limitations: {
          state: 'KNOWN',
          value: {
            entries: [
              {
                kind: 'FORBIDDEN_MOVEMENT',
                label: 'Deep knee flexion',
                affectedExerciseNames: [],
              },
            ],
          },
        },
      }).success,
    ).toBe(false);
  });

  it('bounds schedule, workload and recovery fields', () => {
    expect(
      coachingProfilePatchSchema.safeParse({
        availableWeekdays: { state: 'KNOWN', value: [1, 1] },
      }).success,
    ).toBe(false);
    expect(
      coachingProfilePatchSchema.safeParse({
        outsideActivities: {
          state: 'KNOWN',
          value: [
            {
              type: 'CARDIO',
              name: 'Running',
              sessionsPerWeek: 3,
              minutesPerWeek: 120,
              intensity: 'MODERATE',
            },
          ],
        },
        averageSleepHours: { state: 'KNOWN', value: 7.5 },
        baselineStress: { state: 'KNOWN', value: 3 },
        generalRecovery: { state: 'KNOWN', value: 4 },
      }).success,
    ).toBe(true);
    expect(
      coachingProfilePatchSchema.safeParse({
        averageSleepHours: { state: 'KNOWN', value: 25 },
      }).success,
    ).toBe(false);
  });
});
