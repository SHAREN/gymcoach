import { expect, test, type Page } from '@playwright/test';

async function seedSession(page: Page): Promise<{ sessionId: string }> {
  const firstExerciseRes = await page.request.post('/api/exercises', {
    data: { name: 'E2E Navigation Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(firstExerciseRes.ok()).toBeTruthy();
  const firstExercise = await firstExerciseRes.json();

  const secondExerciseRes = await page.request.post('/api/exercises', {
    data: { name: 'E2E Navigation Row', muscleGroup: 'BACK_THICKNESS', category: 'COMPOUND' },
  });
  expect(secondExerciseRes.ok()).toBeTruthy();
  const secondExercise = await secondExerciseRes.json();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'E2E Navigation Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Navigation day' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  for (const exerciseId of [firstExercise.id, secondExercise.id]) {
    const response = await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
      data: {
        exerciseId,
        targetSets: 3,
        targetRepsMin: 6,
        targetRepsMax: 10,
        targetRIR: 2,
        restSec: 90,
      },
    });
    expect(response.ok()).toBeTruthy();
  }

  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();
  return { sessionId: session.id as string };
}

test('the current session thumbnail opens exercise detail and Back restores the same exercise', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.31' },
    data: {
      displayName: 'Navigation E2E',
      email: `e2e-session-navigation-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { sessionId } = await seedSession(page);
  await page.goto(`/session/${sessionId}`);

  const first = page.getByRole('button', { name: '1. E2E Navigation Bench' });
  const second = page.getByRole('button', { name: '2. E2E Navigation Row' });
  await expect(first).toHaveAttribute('aria-current', 'step');

  await second.click();
  await expect(second).toHaveAttribute('aria-current', 'step');

  await second.click();
  await expect(page.getByRole('heading', { name: 'E2E Navigation Row', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/exercises\/[^?]+\?returnTo=/u);

  const back = page.locator('main a').first();
  await back.click();

  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}\\?programExerciseId=`));
  await expect(page.getByRole('button', { name: '2. E2E Navigation Row' })).toHaveAttribute(
    'aria-current',
    'step',
  );
});
