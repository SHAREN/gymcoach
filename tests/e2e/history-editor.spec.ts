import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function createFinishedEquipmentSession(page: Page) {
  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Historical Cable Pressdown',
      muscleGroup: 'TRICEPS',
      category: 'ISOLATION',
      equipmentType: 'CABLE',
    },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const gymResponse = await page.request.post('/api/gyms', {
    data: { name: 'E2E Historical Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
  });
  expect(gymResponse.ok()).toBeTruthy();
  const gym = await gymResponse.json();

  const equipmentResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'E2E Historical Cable',
      equipmentType: 'CABLE',
      loadType: 'SELECTORIZED',
      weightOptions: [10, 20, 30],
      selectedLoadMultiplier: 0.5,
      exerciseIds: [exercise.id],
    },
  });
  expect(equipmentResponse.ok()).toBeTruthy();
  const equipment = (await equipmentResponse.json()).equipment;

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Historical Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();
  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Historical cable day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();
  const programExerciseResponse = await page.request.post(
    `/api/workouts/${workout.id}/program-exercises`,
    {
      data: {
        exerciseId: exercise.id,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 90,
      },
    },
  );
  expect(programExerciseResponse.ok()).toBeTruthy();

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  const setResponse = await page.request.post(`/api/sessions/${session.id}/sets`, {
    data: {
      exerciseId: exercise.id,
      gymEquipmentId: equipment.id,
      setNumber: 1,
      weight: 10,
      reps: 10,
      rir: 2,
    },
  });
  expect(setResponse.ok()).toBeTruthy();
  const finishResponse = await page.request.put(`/api/sessions/${session.id}`, {
    data: { finish: true },
  });
  expect(finishResponse.ok()).toBeTruthy();
  const finished = await finishResponse.json();

  return {
    sessionId: session.id as string,
    finishedAt: finished.finishedAt as string,
  };
}

test('completed strength history supports edit, add, delete, and reload on mobile', async ({
  page,
}) => {
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.77' },
    data: {
      displayName: 'History Editor E2E',
      email: `e2e-history-editor-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const { sessionId, finishedAt } = await createFinishedEquipmentSession(page);
  await page.goto(`/history/${sessionId}`);

  await expect(page.getByTestId('history-strength-set-editor')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();

  await page.getByRole('button', { name: 'Edit set 1 weight in KG' }).click();
  await page.getByTestId('set-value-options').getByText('20 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await expect(page.getByText('Volume: 200 kg')).toBeVisible();
  await expect(page.getByText('Est. 1RM: 26.7 kg')).toBeVisible();

  await page.getByRole('button', { name: 'New set 2 weight in KG' }).click();
  await page.getByTestId('set-value-options').getByText('30 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await page.getByRole('button', { name: 'Add historical set 2' }).click();
  await expect(page.getByTestId('history-set-row-2')).toBeVisible();
  await expect(
    page.getByText('Sets', { exact: true }).locator('..').getByText('2', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Volume: 500 kg')).toBeVisible();

  await page.getByRole('button', { name: 'Delete set 2' }).click();
  await expect(page.getByText(/permanently deleted from this completed workout/i)).toBeVisible();
  await page.getByRole('button', { name: 'Delete set' }).click();
  await expect(page.getByTestId('history-set-row-2')).toHaveCount(0);
  await expect(
    page.getByText('Sets', { exact: true }).locator('..').getByText('1', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Volume: 200 kg')).toBeVisible();

  await page.getByRole('button', { name: 'Delete set 1' }).click();
  await page.getByRole('button', { name: 'Delete set' }).click();
  await expect(page.getByTestId('history-set-row-1')).toHaveCount(0);
  await expect(page.getByTestId('history-strength-set-editor')).toBeVisible();
  await expect(
    page.getByText('Sets', { exact: true }).locator('..').getByText('0', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New set 1 weight in KG' }).click();
  await page.getByTestId('set-value-options').getByText('20 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await page.getByRole('button', { name: 'Add historical set 1' }).click();
  await expect(page.getByTestId('history-set-row-1')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit set 1 weight in KG' })).toContainText('20');
  await expect(page.getByTestId('history-set-row-2')).toHaveCount(0);
  const persisted = await page.request.get(`/api/sessions/${sessionId}`);
  expect(persisted.ok()).toBeTruthy();
  const session = await persisted.json();
  expect(session.finishedAt).toBe(finishedAt);
  expect(session.sets).toHaveLength(1);
  expect(session.sets[0]).toMatchObject({ weight: 20, reps: 10, rir: 2 });
});
