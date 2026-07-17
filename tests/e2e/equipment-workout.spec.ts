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

test('mobile exercise detail and workout use the preferred 10 kg bar profile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.45' },
    data: {
      displayName: 'Preferred bar E2E',
      email: `e2e-preferred-bar-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();

  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E EZ Skull Crusher',
      muscleGroup: 'TRICEPS',
      category: 'ISOLATION',
      equipmentType: 'BARBELL',
    },
  });
  const exercise = await exerciseResponse.json();
  const gymResponse = await page.request.post('/api/gyms', {
    data: { name: 'Zulu E2E Bar Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
  });
  const gym = await gymResponse.json();
  const otherGymResponse = await page.request.post('/api/gyms', {
    data: { name: 'Alpha E2E Other Gym', inventoryMode: 'EQUIPMENT_FIRST' },
  });
  expect(otherGymResponse.ok()).toBeTruthy();
  const otherGym = await otherGymResponse.json();
  const poolResponse = await page.request.post(`/api/gyms/${gym.id}/plate-pools`, {
    data: {
      name: 'E2E Olympic plates',
      compatibilityKey: 'e2e_olympic',
      plates: [
        { weightKg: 10, quantity: 2 },
        { weightKg: 5, quantity: 4 },
      ],
    },
  });
  expect(poolResponse.ok()).toBeTruthy();
  const pool = await poolResponse.json();
  const standardResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: '20 kg standard bar',
      equipmentType: 'BARBELL',
      loadType: 'PLATE_LOADED',
      baseLoadKg: 20,
      platePoolId: pool.id,
      loadingSides: 2,
      exerciseIds: [exercise.id],
    },
  });
  expect(standardResponse.ok()).toBeTruthy();
  const standardBar = (await standardResponse.json()).equipment;
  const smallBarResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: '10 kg EZ bar',
      equipmentType: 'BARBELL',
      loadType: 'PLATE_LOADED',
      baseLoadKg: 10,
      platePoolId: pool.id,
      loadingSides: 2,
      exerciseIds: [exercise.id],
    },
  });
  expect(smallBarResponse.ok()).toBeTruthy();
  const smallBar = (await smallBarResponse.json()).equipment;
  const otherBarResponse = await page.request.post(`/api/gyms/${otherGym.id}/equipment`, {
    data: {
      name: 'Other gym EZ bar',
      equipmentType: 'BARBELL',
      exerciseIds: [exercise.id],
      preferredExerciseIds: [exercise.id],
    },
  });
  expect(otherBarResponse.ok()).toBeTruthy();
  const otherBar = (await otherBarResponse.json()).equipment;

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Preferred Bar Program', phase: 'Base' },
  });
  const program = await programResponse.json();
  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'EZ day' },
  });
  const workout = await workoutResponse.json();
  await page.request.post(`/api/workouts/${workout.id}/program-exercises`, {
    data: {
      exerciseId: exercise.id,
      targetSets: 1,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetRIR: 2,
      restSec: 15,
    },
  });
  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  const session = await sessionResponse.json();

  await page.goto(`/exercises/${exercise.id}`);
  await expect(page.getByRole('button', { name: 'Edit exercise' })).toBeVisible();
  await expect(page.getByText('10 kg EZ bar')).toBeVisible();
  await expect(page.getByText('20 kg standard bar')).toBeVisible();
  await expect(page.getByText('Preferred')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit exercise' }).click();
  let dialog = page.getByRole('dialog');
  const activeHeading = dialog.getByText('Zulu E2E Bar Gym · Active gym');
  const otherHeading = dialog.getByText('Alpha E2E Other Gym');
  const activeBox = await activeHeading.boundingBox();
  const otherBox = await otherHeading.boundingBox();
  expect(activeBox).not.toBeNull();
  expect(otherBox).not.toBeNull();
  expect(activeBox!.y).toBeLessThan(otherBox!.y);
  await dialog.getByRole('button', { name: 'Use 10 kg EZ bar by default in this gym' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByText('10 kg EZ bar')).toBeVisible();
  await expect(page.getByText('Preferred')).toBeVisible();
  await expect(page.getByText('Empty load: 10 kg')).toBeVisible();
  await expect(page.getByText('20 kg standard bar')).toBeVisible();

  let otherInventory = await (await page.request.get(`/api/gyms/${otherGym.id}/inventory`)).json();
  expect(
    otherInventory.gym.exerciseCoverage.find((item: { id: string }) => item.id === exercise.id)
      .preferredEquipmentId,
  ).toBe(otherBar.id);

  await page.goto('/settings');
  await expect(page.getByText('10 kg EZ bar', { exact: true })).toBeVisible();
  await expect(page.getByText('20 kg standard bar', { exact: true })).toBeVisible();
  let standardCard = page
    .getByText('20 kg standard bar', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-md border p-3")][1]');
  await standardCard.getByRole('button', { name: 'Edit equipment' }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByRole('button', {
      name: 'Use this equipment by default for E2E EZ Skull Crusher',
    })
    .click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  standardCard = page
    .getByText('20 kg standard bar', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-md border p-3")][1]');
  await standardCard.getByRole('button', { name: 'Edit equipment' }).click();
  dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', {
      name: 'Use this equipment by default for E2E EZ Skull Crusher',
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.goto(`/exercises/${exercise.id}`);
  const standardDetailCard = page
    .getByText('20 kg standard bar', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-md border p-3")][1]');
  await expect(standardDetailCard.getByText('Preferred')).toBeVisible();
  await expect(page.getByText('10 kg EZ bar', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Edit exercise' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Use 10 kg EZ bar by default in this gym' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  const smallDetailCard = page
    .getByText('10 kg EZ bar', { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-md border p-3")][1]');
  await expect(smallDetailCard.getByText('Preferred')).toBeVisible();
  await expect(page.getByText('20 kg standard bar', { exact: true })).toBeVisible();

  const activeInventory = await (await page.request.get(`/api/gyms/${gym.id}/inventory`)).json();
  expect(
    activeInventory.gym.exerciseCoverage.find((item: { id: string }) => item.id === exercise.id),
  ).toMatchObject({
    preferredEquipmentId: smallBar.id,
    equipmentIds: expect.arrayContaining([smallBar.id, standardBar.id]),
  });
  otherInventory = await (await page.request.get(`/api/gyms/${otherGym.id}/inventory`)).json();
  expect(
    otherInventory.gym.exerciseCoverage.find((item: { id: string }) => item.id === exercise.id)
      .preferredEquipmentId,
  ).toBe(otherBar.id);

  await page.goto(`/session/${session.id}`);
  await expect(page.getByRole('combobox', { name: 'Equipment used' })).toContainText(
    '10 kg EZ bar',
  );
  await page.getByRole('button', { name: 'Set 1 weight in KG' }).click();
  await page.getByTestId('set-value-options').getByText('40 kg').click();
  await expect(page.getByTestId('barbell-weight-label')).toContainText('Bar 10 kg');
  await expect(page.getByTestId('barbell-plates')).toBeVisible();
});

test('settings exposes permanent Dumbbells and isolated Barbell system profiles', async ({
  page,
}) => {
  const registerResponse = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.46' },
    data: {
      displayName: 'System Profiles E2E',
      email: `e2e-system-profiles-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(registerResponse.ok()).toBeTruthy();
  const dumbbellExercise = await (
    await page.request.post('/api/exercises', {
      data: {
        name: 'E2E Dumbbell Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
        equipmentType: 'DUMBBELL',
      },
    })
  ).json();
  const barbellExercise = await (
    await page.request.post('/api/exercises', {
      data: {
        name: 'E2E Barbell Squat',
        muscleGroup: 'QUADS',
        category: 'COMPOUND',
        equipmentType: 'BARBELL',
      },
    })
  ).json();
  const gym = await (
    await page.request.post('/api/gyms', {
      data: { name: 'E2E System Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
    })
  ).json();
  expect(
    (
      await page.request.put(`/api/gyms/${gym.id}/system-profiles/dumbbells`, {
        data: { weightsKg: [10, 12.5, 20], exerciseIds: [dumbbellExercise.id] },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.put(`/api/gyms/${gym.id}/system-profiles/barbell`, {
        data: {
          exerciseIds: [barbellExercise.id],
          families: [
            {
              family: 'LARGE',
              loadingSides: 2,
              bars: [{ weightKg: 12 }, { weightKg: 17.5 }, { weightKg: 20 }],
              plates: [
                { weightKg: 1.25, quantity: null },
                { weightKg: 2.5, quantity: null },
                { weightKg: 5, quantity: null },
                { weightKg: 10, quantity: null },
                { weightKg: 15, quantity: null },
                { weightKg: 20, quantity: null },
              ],
            },
            {
              family: 'SMALL',
              loadingSides: 2,
              bars: [{ weightKg: 6 }],
              plates: [
                { weightKg: 1.25, quantity: null },
                { weightKg: 2.5, quantity: null },
                { weightKg: 3.5, quantity: null },
                { weightKg: 5, quantity: null },
              ],
            },
          ],
        },
      })
    ).ok(),
  ).toBeTruthy();

  await page.goto('/settings');
  await expect(page.getByTestId('system-profile-dumbbells')).toContainText('Dumbbells');
  await expect(page.getByTestId('system-profile-barbell')).toContainText('Barbell');
  await expect(page.getByText('Derived exercise availability')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit Dumbbells profile' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit Barbell profile' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Barbell profile' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Large / thick diameter')).toBeVisible();
  await expect(dialog.getByText('Small / thin diameter')).toBeVisible();
  const barbellInputValues = await dialog
    .locator('input')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(barbellInputValues).toEqual(expect.arrayContaining(['17.5', '6']));
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const inventory = await (await page.request.get(`/api/gyms/${gym.id}/inventory`)).json();
  const coverage = inventory.gym.exerciseCoverage.find(
    (item: { id: string }) => item.id === barbellExercise.id,
  );
  const largeBar = coverage.equipmentOptions.find(
    (item: { baseLoadKg: number }) => item.baseLoadKg === 12,
  );
  const smallBar = coverage.equipmentOptions.find(
    (item: { baseLoadKg: number }) => item.baseLoadKg === 6,
  );
  const largeFamily = inventory.gym.systemProfiles.barbell.families.find(
    (family: { family: string }) => family.family === 'LARGE',
  );
  const smallFamily = inventory.gym.systemProfiles.barbell.families.find(
    (family: { family: string }) => family.family === 'SMALL',
  );
  expect(largeBar.attainableLoads).toContain(32);
  expect(smallBar.attainableLoads).toContain(13);
  expect(largeBar.platePoolId).toBe(largeFamily.pool.id);
  expect(smallBar.platePoolId).toBe(smallFamily.pool.id);
  expect(largeBar.plates.map((plate: { weightKg: number }) => plate.weightKg)).toEqual([
    1.25, 2.5, 5, 10, 15, 20,
  ]);
  expect(smallBar.plates.map((plate: { weightKg: number }) => plate.weightKg)).toEqual([
    1.25, 2.5, 3.5, 5,
  ]);
});
