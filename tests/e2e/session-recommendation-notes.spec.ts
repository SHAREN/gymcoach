import { expect, test, type Page } from '@playwright/test';

async function seedSession(page: Page): Promise<string> {
  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Compact Squat',
      muscleGroup: 'QUADS',
      category: 'COMPOUND',
      notes: 'Technique cue belongs on exercise detail only',
    },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Recommendation Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();

  const workoutResponse = await page.request.post('/api/programs/' + program.id + '/workouts', {
    data: { name: 'Recommendation day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();

  const programmedResponse = await page.request.post(
    '/api/workouts/' + workout.id + '/program-exercises',
    {
      data: {
        exerciseId: exercise.id,
        targetSets: 3,
        targetRepsMin: 6,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 90,
        notes: [
          'Alpha prescription: 3 sets; 12 reps',
          'Keep knees tracking over toes.',
          'Alpha metadata: Superset 1',
        ].join(String.fromCharCode(10)),
      },
    },
  );
  expect(programmedResponse.ok()).toBeTruthy();

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  return session.id as string;
}

test('recommendation is explicit and reusable while the live card stays compact', async ({
  page,
}) => {
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.34' },
    data: {
      displayName: 'Recommendation E2E',
      email: 'e2e-recommendation-' + Date.now() + '@test.dev',
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const sessionId = await seedSession(page);
  await page.goto('/session/' + sessionId);

  const currentRow = page.getByTestId('current-set-row');
  await expect(currentRow.getByLabel('Quick entry')).toBeVisible();
  await expect(currentRow.getByRole('button', { name: /log the set/i })).toBeVisible();

  await expect(page.getByText('Technique cue belongs on exercise detail only')).toHaveCount(0);
  await expect(page.getByText('Quadriceps')).toHaveCount(0);
  await page.getByRole('button', { name: /notes/i }).click();
  await expect(page.getByText('Keep knees tracking over toes.')).toBeVisible();
  await expect(page.getByText(/Alpha prescription/)).toHaveCount(0);
  await expect(page.getByText(/Alpha metadata/)).toHaveCount(0);

  await page.getByLabel('Quick entry').fill('100x12@8');
  await page.getByRole('button', { name: /log the set/i }).click();
  await page.getByRole('button', { name: 'Skip' }).click();

  const apply = page.getByRole('button', { name: 'Apply recommendation' });
  await expect(apply).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reps' })).toHaveText('12');
  await expect(apply).toBeEnabled();

  await apply.click();
  await expect(apply).toBeDisabled();
  const recommendedReps = await page.getByRole('button', { name: 'Reps' }).textContent();
  expect(recommendedReps).not.toBe('12');

  await page.getByRole('button', { name: '+1 rep' }).click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(apply).toBeDisabled();

  await page.getByRole('button', { name: 'Undo last set' }).click();
  await expect(page.getByRole('button', { name: 'Undo last set' })).toHaveCount(0);
  await expect(page.getByTestId('current-set-row')).toContainText('Set 1 · in progress');
});
