import { expect, test, type Page } from '@playwright/test';

async function register(page: Page, label: string, forwardedFor: string) {
  const response = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': forwardedFor },
    data: {
      displayName: label,
      email: `e2e-${label.toLowerCase().replaceAll(' ', '-')}-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function createExercise(
  page: Page,
  name: string,
  overrides: Partial<{
    muscleGroup: string;
    category: string;
    equipmentType: string;
    defaultRestSec: number;
    notes: string;
  }> = {},
) {
  const response = await page.request.post('/api/exercises', {
    data: {
      name,
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'MACHINE',
      defaultRestSec: 90,
      notes: 'Original technique note',
      ...overrides,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<{ id: string; name: string }>;
}

async function createMixedCategorySession(
  page: Page,
  strengthExerciseId: string,
  cardioExerciseId: string,
) {
  const gymResponse = await page.request.post('/api/gyms', {
    data: { name: 'E2E Mixed Detail Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
  });
  expect(gymResponse.ok()).toBeTruthy();
  const gym = await gymResponse.json();

  const strengthEquipmentResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'E2E Mixed Press Machine',
      equipmentType: 'MACHINE',
      loadType: 'FIXED',
      weightOptions: [10, 20, 30],
      exerciseIds: [strengthExerciseId],
      preferredExerciseIds: [strengthExerciseId],
    },
  });
  expect(strengthEquipmentResponse.ok()).toBeTruthy();
  const strengthEquipmentPayload = await strengthEquipmentResponse.json();
  const strengthEquipment = strengthEquipmentPayload.equipment ?? strengthEquipmentPayload;

  const cardioEquipmentResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'E2E Mixed Treadmill',
      equipmentType: 'CARDIO',
      loadType: 'NONE',
      exerciseIds: [cardioExerciseId],
      preferredExerciseIds: [cardioExerciseId],
    },
  });
  expect(cardioEquipmentResponse.ok()).toBeTruthy();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Mixed Detail Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();

  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Mixed detail day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();

  for (const exerciseId of [strengthExerciseId, cardioExerciseId]) {
    const programExerciseResponse = await page.request.post(
      `/api/workouts/${workout.id}/program-exercises`,
      {
        data: {
          exerciseId,
          targetSets: 3,
          targetRepsMin: exerciseId === cardioExerciseId ? 1 : 8,
          targetRepsMax: exerciseId === cardioExerciseId ? 1 : 12,
          targetRIR: exerciseId === cardioExerciseId ? 0 : 2,
          restSec: 60,
        },
      },
    );
    expect(programExerciseResponse.ok()).toBeTruthy();
  }

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();

  return {
    sessionId: session.id as string,
    strengthEquipmentId: strengthEquipment.id as string,
  };
}

async function createActiveSession(page: Page, exerciseIds: string[]) {
  const gymResponse = await page.request.post('/api/gyms', {
    data: { name: 'E2E Canonical Detail Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
  });
  expect(gymResponse.ok()).toBeTruthy();
  const gym = await gymResponse.json();

  const primaryEquipmentResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'E2E Fixed Press Machine A',
      equipmentType: 'MACHINE',
      loadType: 'FIXED',
      weightOptions: [10, 20, 30],
      exerciseIds,
      preferredExerciseIds: exerciseIds,
    },
  });
  expect(primaryEquipmentResponse.ok()).toBeTruthy();

  const alternateEquipmentResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'E2E Fixed Press Machine B',
      equipmentType: 'MACHINE',
      loadType: 'FIXED',
      weightOptions: [15, 25, 35],
      exerciseIds,
      preferredExerciseIds: [],
    },
  });
  expect(alternateEquipmentResponse.ok()).toBeTruthy();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Canonical Detail Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();

  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Canonical detail day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();

  for (const exerciseId of exerciseIds) {
    const programExerciseResponse = await page.request.post(
      `/api/workouts/${workout.id}/program-exercises`,
      {
        data: {
          exerciseId,
          targetSets: 2,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetRIR: 2,
          restSec: 90,
        },
      },
    );
    expect(programExerciseResponse.ok()).toBeTruthy();
  }

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  return session.id as string;
}

test('catalog uses the canonical editable exercise detail and returns with refreshed data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, 'Catalog canonical detail', '10.111.0.101');
  const exercise = await createExercise(page, 'E2E Catalog Canonical Press');

  await page.goto('/exercises');
  const catalogLink = page.getByRole('link', { name: /E2E Catalog Canonical Press/ });
  await expect(catalogLink).toHaveAttribute('href', `/exercises/${exercise.id}`);
  await catalogLink.click();
  await expect(page).toHaveURL(`/exercises/${exercise.id}`);

  const editButton = page.getByRole('button', { name: 'Edit exercise' });
  await expect(editButton).toBeVisible();
  expect((await editButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: /View technique/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Training history' })).toBeVisible();
  await expect(page.getByText('Active gym equipment')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await editButton.click();
  const dialog = page.getByRole('dialog');
  const nameInput = dialog.getByLabel('Name');
  await expect(nameInput).toBeFocused();
  await nameInput.fill('Cancelled catalog edit');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(editButton).toBeFocused();
  await expect(page.getByRole('heading', { name: 'E2E Catalog Canonical Press' })).toBeVisible();

  await editButton.click();
  await expect(dialog.getByLabel('Name')).toHaveValue('E2E Catalog Canonical Press');
  await dialog.getByLabel('Name').fill('E2E Catalog Canonical Press Updated');
  await dialog.getByLabel('Default rest (seconds)').fill('135');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(editButton).toBeFocused();
  await expect(
    page.getByRole('heading', { name: 'E2E Catalog Canonical Press Updated' }),
  ).toBeVisible();
  await expect(page.getByText('135 sec')).toBeVisible();

  await page.getByRole('link', { name: 'Back to exercises' }).click();
  await expect(page).toHaveURL('/exercises');
  await expect(
    page.getByRole('link', { name: /E2E Catalog Canonical Press Updated/ }),
  ).toBeVisible();
});

test('session detail editing and Back preserve the selected exercise, draft, targets, sets and rest', async ({
  page,
}) => {
  await register(page, 'Session canonical detail', '10.111.0.102');
  const firstExercise = await createExercise(page, 'E2E Session Canonical Row');
  const exercise = await createExercise(page, 'E2E Session Canonical Press');
  const sessionId = await createActiveSession(page, [firstExercise.id, exercise.id]);

  await page.goto(`/session/${sessionId}`);
  const equipmentSelector = page.getByRole('combobox', { name: 'Equipment used' });
  await expect(equipmentSelector).toHaveText('E2E Fixed Press Machine A');
  const weightButton = page.getByRole('button', { name: 'Set 1 weight in KG' });
  await weightButton.click();
  await page.getByTestId('set-value-options').getByText('20 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await expect(weightButton).toHaveText('20');

  await page.getByRole('button', { name: `2. ${exercise.name}` }).click();
  await expect(page).toHaveURL(`/session/${sessionId}?exerciseId=${exercise.id}`);
  await equipmentSelector.click();
  await page.getByRole('option', { name: 'E2E Fixed Press Machine B' }).click();
  await expect(equipmentSelector).toHaveText('E2E Fixed Press Machine B');
  await weightButton.click();
  await page.getByTestId('set-value-options').getByText('25 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await expect(weightButton).toHaveText('25');

  await page.getByRole('button', { name: 'Adjust set count' }).click();
  const setControls = page.getByTestId('set-controls-dialog');
  await expect(setControls).toBeVisible();
  const initialTarget = Number(await page.getByTestId('set-count-value').textContent());
  await page.getByRole('button', { name: 'Increase total sets' }).click();
  const increasedTarget = initialTarget + 1;
  await expect(setControls).toHaveAttribute('aria-busy', 'false');
  await setControls.getByRole('button', { name: 'Close' }).click();
  await expect(setControls).toBeHidden();

  await page.locator('button[aria-current="step"]').click();
  await expect(page).toHaveURL(
    `/exercises/${exercise.id}?returnTo=%2Fsession%2F${sessionId}%3FexerciseId%3D${exercise.id}`,
  );
  const detailEditButton = page.getByRole('button', { name: 'Edit exercise', exact: true });
  await detailEditButton.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('E2E Session Canonical Press Updated');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(detailEditButton).toBeFocused();
  await page.getByRole('link', { name: 'Back to workout' }).click();

  await expect(page).toHaveURL(`/session/${sessionId}?exerciseId=${exercise.id}`);
  await expect(page.locator('button[aria-current="step"]')).toHaveAttribute(
    'aria-label',
    '2. E2E Session Canonical Press Updated',
  );
  await expect(equipmentSelector).toHaveText('E2E Fixed Press Machine B');
  await expect(weightButton).toHaveText('25');
  await page.getByRole('button', { name: 'Adjust set count' }).click();
  await expect(page.getByTestId('set-count-value')).toHaveText(String(increasedTarget));
  await setControls.getByRole('button', { name: 'Close' }).click();
  await expect(setControls).toBeHidden();

  await weightButton.click();
  await page.getByTestId('set-value-options').getByText('35 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await expect(weightButton).toHaveText('35');

  await page.getByRole('button', { name: `1. ${firstExercise.name}` }).click();
  await expect(page).toHaveURL(`/session/${sessionId}?exerciseId=${firstExercise.id}`);
  await expect(equipmentSelector).toHaveText('E2E Fixed Press Machine A');
  await expect(weightButton).toHaveText('20');

  await page.locator('button[aria-current="step"]').click();
  await expect(page).toHaveURL(
    `/exercises/${firstExercise.id}?returnTo=%2Fsession%2F${sessionId}%3FexerciseId%3D${firstExercise.id}`,
  );
  await page.getByRole('link', { name: 'Back to workout' }).click();
  await expect(page).toHaveURL(`/session/${sessionId}?exerciseId=${firstExercise.id}`);
  await expect(equipmentSelector).toHaveText('E2E Fixed Press Machine A');
  await expect(weightButton).toHaveText('20');

  await page.getByRole('button', { name: '2. E2E Session Canonical Press Updated' }).click();
  await expect(page).toHaveURL(`/session/${sessionId}?exerciseId=${exercise.id}`);
  await expect(equipmentSelector).toHaveText('E2E Fixed Press Machine B');
  await expect(weightButton).toHaveText('35');

  await page.getByRole('button', { name: 'Confirm set 1' }).click();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  const restRemaining = page.getByTestId('rest-remaining');
  await expect(restRemaining).toBeVisible();
  const remainingBeforeDetail = Number(await restRemaining.textContent());

  await page.locator('button[aria-current="step"]').click();
  await expect(page).toHaveURL(
    `/exercises/${exercise.id}?returnTo=%2Fsession%2F${sessionId}%3FexerciseId%3D${exercise.id}`,
  );
  await page.getByRole('link', { name: 'Back to workout' }).click();

  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  await expect(restRemaining).toBeVisible();
  await expect
    .poll(async () => Number(await restRemaining.textContent()))
    .toBeLessThanOrEqual(remainingBeforeDetail);
  expect(Number(await restRemaining.textContent())).toBeGreaterThan(0);
});

test('mixed strength and cardio drafts survive detail return and completed-set hydration', async ({
  page,
}) => {
  await register(page, 'Mixed session detail', '10.111.0.105');
  const strengthExercise = await createExercise(page, 'E2E Mixed Session Press');
  const cardioExercise = await createExercise(page, 'E2E Mixed Session Run', {
    muscleGroup: 'OTHER',
    category: 'CARDIO',
    equipmentType: 'CARDIO',
    defaultRestSec: 60,
  });
  const { sessionId, strengthEquipmentId } = await createMixedCategorySession(
    page,
    strengthExercise.id,
    cardioExercise.id,
  );
  const completedSetResponse = await page.request.post(`/api/sessions/${sessionId}/sets`, {
    data: {
      exerciseId: strengthExercise.id,
      gymEquipmentId: strengthEquipmentId,
      setNumber: 1,
      weight: 10,
      reps: 10,
      rir: 2,
    },
  });
  expect(completedSetResponse.ok()).toBeTruthy();

  await page.goto(`/session/${sessionId}`);
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  const strengthWeight = page.getByRole('button', { name: 'Set 2 weight in KG' });
  await strengthWeight.click();
  await page.getByTestId('set-value-options').getByText('20 kg').click();
  await page.getByRole('button', { name: 'Apply value' }).click();
  await expect(strengthWeight).toHaveText('20');

  await page.getByRole('button', { name: `2. ${cardioExercise.name}` }).click();
  await page.getByLabel(/duration/i).fill('12:30');
  await page.getByLabel(/distance/i).fill('2.5');

  await page.locator('button[aria-current="step"]').click();
  await expect(page).toHaveURL(
    `/exercises/${cardioExercise.id}?returnTo=%2Fsession%2F${sessionId}%3FexerciseId%3D${cardioExercise.id}`,
  );
  await page.getByRole('link', { name: 'Back to workout' }).click();

  await expect(page).toHaveURL(`/session/${sessionId}?exerciseId=${cardioExercise.id}`);
  await expect(page.getByLabel(/duration/i)).toHaveValue('12:30');
  await expect(page.getByLabel(/distance/i)).toHaveValue('2.5');

  await page.getByRole('button', { name: `1. ${strengthExercise.name}` }).click();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  await expect(strengthWeight).toHaveText('20');

  await page.getByRole('button', { name: `2. ${cardioExercise.name}` }).click();
  await expect(page.getByLabel(/duration/i)).toHaveValue('12:30');
  await expect(page.getByLabel(/distance/i)).toHaveValue('2.5');

  await page.getByRole('button', { name: /log the set/i }).click();
  await expect(page.getByText('12:30 · 2.5 km')).toBeVisible();
  await page.getByRole('button', { name: /skip/i }).click();
  await expect(page.getByLabel(/duration/i)).toHaveValue('12:30');
  await expect(page.getByLabel(/distance/i)).toHaveValue('2.5');
});

test('an unowned exercise detail returns 404 and exposes no edit action', async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await register(ownerPage, 'Owned exercise detail', '10.111.0.103');
  const exercise = await createExercise(ownerPage, 'E2E Private Exercise');
  await ownerContext.close();

  const strangerContext = await browser.newContext();
  const strangerPage = await strangerContext.newPage();
  await register(strangerPage, 'Stranger exercise detail', '10.111.0.104');
  const response = await strangerPage.goto(`/exercises/${exercise.id}`);
  expect(response?.status()).toBe(404);
  await expect(strangerPage.getByRole('button', { name: 'Edit exercise' })).toHaveCount(0);
  await strangerContext.close();
});
