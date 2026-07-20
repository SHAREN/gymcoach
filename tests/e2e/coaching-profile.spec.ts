import { test, expect } from '@playwright/test';

test('settings edits the structured coaching profile with partial-save semantics', async ({
  page,
}) => {
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.73' },
    data: {
      displayName: 'Coaching Profile E2E',
      email: `e2e-coaching-profile-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();
  expect(
    (
      await page.request.patch('/api/profile', {
        data: {
          goal: 'STRENGTH',
          coachingProfile: {
            healthStatus: { state: 'KNOWN', value: 'TRAIN_WITH_LIMITATIONS' },
            trainingLevel: { state: 'KNOWN', value: 'INTERMEDIATE' },
            availableWeekdays: { state: 'KNOWN', value: [1, 3, 5] },
            maximumSessionDurationMin: { state: 'KNOWN', value: 75 },
            limitations: {
              state: 'KNOWN',
              value: {
                entries: [
                  {
                    kind: 'DISCOURAGED_EXERCISE',
                    label: 'Self-reported pressing constraint',
                    affectedExerciseNames: ['Bench press'],
                  },
                ],
              },
            },
            priorityMuscles: { state: 'KNOWN', value: ['BACK_WIDTH'] },
            priorityStrengthMovements: { state: 'KNOWN', value: ['Pull-up'] },
            outsideActivities: {
              state: 'KNOWN',
              value: [{ type: 'CARDIO', name: 'Cycling', minutesPerWeek: 90 }],
            },
            likedExercises: { state: 'KNOWN', value: ['Pull-up'] },
            dislikedExercises: { state: 'NOT_APPLICABLE' },
            averageSleepHours: { state: 'KNOWN', value: 7.5 },
            baselineStress: { state: 'KNOWN', value: 3 },
            generalRecovery: { state: 'KNOWN', value: 4 },
          },
        },
      })
    ).ok(),
  ).toBeTruthy();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Coaching profile' })).toBeVisible();
  await expect(page.getByLabel('Movement or issue')).toHaveValue(
    'Self-reported pressing constraint',
  );
  await expect(page.getByLabel('Affected exercise names')).toHaveValue('Bench press');
  await expect(page.getByRole('checkbox', { name: 'Monday' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Tuesday' })).not.toBeChecked();
  await expect(
    page.getByRole('spinbutton', { name: 'Maximum session duration (minutes)' }),
  ).toHaveValue('75');
  await expect(page.getByRole('textbox', { name: 'Priority strength movements' })).toHaveValue(
    'Pull-up',
  );
  await expect(page.getByRole('textbox', { name: 'Liked exercises' })).toHaveValue('Pull-up');
  await expect(page.getByRole('spinbutton', { name: 'Average sleep (hours)' })).toHaveValue('7.5');

  await page.getByRole('spinbutton', { name: 'Maximum session duration (minutes)' }).fill('80');
  await page.getByRole('button', { name: 'Save safety and schedule' }).click();
  await expect(page.getByText('Coaching profile section saved.')).toBeVisible();

  const profile = await (await page.request.get('/api/profile')).json();
  expect(profile.coachingProfile.maximumSessionDurationMin).toMatchObject({
    state: 'KNOWN',
    value: 80,
  });
  expect(profile.coachingProfile.limitations).toMatchObject({
    state: 'KNOWN',
    value: {
      entries: [
        expect.objectContaining({
          label: 'Self-reported pressing constraint',
          affectedExerciseNames: ['Bench press'],
        }),
      ],
    },
  });
});
