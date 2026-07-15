import { expect, test, type Page } from '@playwright/test';

async function createEquipmentWorkout(page: Page) {
  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Cable Pressdown',
      muscleGroup: 'TRICEPS',
      category: 'ISOLATION',
      equipmentType: 'CABLE',
    },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const gymResponse = await page.request.post('/api/gyms', {
    data: { name: 'E2E Equipment Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
  });
  expect(gymResponse.ok()).toBeTruthy();
  const gym = await gymResponse.json();

  const cableAResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'Cable A',
      equipmentType: 'CABLE',
      loadType: 'SELECTORIZED',
      weightOptions: [10, 20],
      selectedLoadMultiplier: 0.5,
      exerciseIds: [exercise.id],
    },
  });
  expect(cableAResponse.ok()).toBeTruthy();
  const cableA = (await cableAResponse.json()).equipment;

  const cableBResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'Cable B',
      equipmentType: 'CABLE',
      loadType: 'SELECTORIZED',
      weightOptions: [15, 25],
      selectedLoadMultiplier: 1,
      exerciseIds: [exercise.id],
    },
  });
  expect(cableBResponse.ok()).toBeTruthy();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Equipment Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();
  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Cable day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();
  const programExerciseResponse = await page.request.post(
    `/api/workouts/${workout.id}/program-exercises`,
    {
      data: {
        exerciseId: exercise.id,
        targetSets: 1,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 15,
      },
    },
  );
  expect(programExerciseResponse.ok()).toBeTruthy();
  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  return { sessionId: session.id as string, cableAId: cableA.id as string };
}

test('a workout selects one physical machine, shows its loads, and logs its snapshot', async ({
  page,
}) => {
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.44' },
    data: {
      displayName: 'Equipment E2E',
      email: `e2e-equipment-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const { sessionId, cableAId } = await createEquipmentWorkout(page);
  await page.goto(`/session/${sessionId}`);

  await expect(page.getByText(/legacy \/ manual load/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set 1 weight in KG' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm set 1' })).toBeDisabled();

  await page.getByRole('combobox', { name: 'Equipment used' }).click();
  await page.getByRole('option', { name: 'Cable A' }).click();
  await expect(page.getByText(/displayed load x 0.5/i)).toBeVisible();

  await page.getByRole('button', { name: 'Set 1 weight in KG' }).click();
  const options = page.getByTestId('set-value-options');
  await expect(options.getByText('10 kg')).toBeVisible();
  await expect(options.getByText('20 kg')).toBeVisible();
  await expect(options.getByText('15 kg')).toHaveCount(0);
  await options.getByText('20 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await page.getByRole('button', { name: 'Confirm set 1' }).click();

  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/sessions/${sessionId}`);
      const session = await response.json();
      return session.sets[0] ?? null;
    })
    .toMatchObject({
      gymEquipmentId: cableAId,
      equipmentNameSnapshot: 'Cable A',
      selectedLoadKg: 20,
      selectedLoadMultiplierSnapshot: 0.5,
      nominalResistanceKg: 10,
    });
});
