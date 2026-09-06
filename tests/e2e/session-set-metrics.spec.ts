import { expect, test, type Page } from '@playwright/test';

async function seedSession(page: Page): Promise<string> {
  const exerciseResponse = await page.request.post('/api/exercises', {
    data: { name: 'E2E Set Metrics Squat', muscleGroup: 'QUADS', category: 'COMPOUND' },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Set Metrics Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();

  const workoutResponse = await page.request.post('/api/programs/' + program.id + '/workouts', {
    data: { name: 'Metrics day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();

  const programmedExerciseResponse = await page.request.post(
    '/api/workouts/' + workout.id + '/program-exercises',
    {
      data: {
        exerciseId: exercise.id,
        targetSets: 3,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetRIR: 2,
        restSec: 90,
      },
    },
  );
  expect(programmedExerciseResponse.ok()).toBeTruthy();

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  return session.id as string;
}

test('set metrics switch between 1RM and 10RM while volume stays selectable', async ({ page }) => {
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.33' },
    data: {
      displayName: 'Set Metrics E2E',
      email: 'e2e-set-metrics-' + Date.now() + '@test.dev',
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const sessionId = await seedSession(page);
  await page.goto('/session/' + sessionId);
  await page.getByText('More set options', { exact: true }).click();

  await page.getByLabel('Quick entry').fill('100x10');
  await expect(page.getByTestId('active-set-metric-1RM')).toContainText('133.3');

  await page.getByRole('button', { name: 'Choose set metrics' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Volume' }).click();
  await expect(page.getByTestId('active-set-metric-VOLUME')).toContainText('1000');

  await page.getByRole('menuitemcheckbox', { name: 'Estimated 10RM' }).click();
  await expect(page.getByTestId('active-set-metric-1RM')).toHaveCount(0);
  await expect(page.getByTestId('active-set-metric-10RM')).toContainText('100');
  await expect(page.getByTestId('active-set-metric-VOLUME')).toContainText('1000');

  await page.reload();
  await expect(page.getByTestId('set-metric-selection')).toContainText('10RM + Vol.');
});
