import { expect, test, type Page } from '@playwright/test';

async function seedSession(page: Page): Promise<{ sessionId: string }> {
  const benchRes = await page.request.post('/api/exercises', {
    data: { name: 'E2E Actions Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(benchRes.ok()).toBeTruthy();
  const bench = await benchRes.json();

  const rowRes = await page.request.post('/api/exercises', {
    data: { name: 'E2E Actions Row', muscleGroup: 'BACK_THICKNESS', category: 'COMPOUND' },
  });
  expect(rowRes.ok()).toBeTruthy();
  const row = await rowRes.json();

  const inclineRes = await page.request.post('/api/exercises', {
    data: { name: 'E2E Actions Incline', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(inclineRes.ok()).toBeTruthy();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'E2E Actions Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Actions day' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  for (const exerciseId of [bench.id, row.id]) {
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

test('session actions edit targets and create or break a superset without leaving the runner', async ({
  page,
}) => {
  const registerRes = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.32' },
    data: {
      displayName: 'Session Actions E2E',
      email: `e2e-session-actions-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  const { sessionId } = await seedSession(page);
  await page.goto(`/session/${sessionId}`);
  await expect(page.getByText(/Exercise 1\/2 · E2E Actions Bench/)).toBeVisible();

  await page.getByRole('button', { name: 'Open exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit targets / replace' }).click();
  await expect(page.getByRole('heading', { name: 'Edit programmed exercise' })).toBeVisible();
  await expect(page.getByLabel('Sets')).toHaveValue('3');
  await page.getByLabel('Sets').fill('4');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/4 sets ×/)).toBeVisible();

  await page.getByRole('button', { name: 'Open exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Superset' }).click();
  await page.getByRole('button', { name: 'Link with E2E Actions Row' }).click();
  await expect(page.getByText('Superset A1')).toBeVisible();

  await page.getByRole('button', { name: 'Open exercise actions' }).click();
  await page.getByRole('menuitem', { name: 'Superset' }).click();
  await page.getByRole('button', { name: 'Break superset' }).click();
  await expect(page.getByText('Superset A1')).toHaveCount(0);
});
