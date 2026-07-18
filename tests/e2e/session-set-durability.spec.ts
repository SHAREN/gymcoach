import { expect, test, type Page } from '@playwright/test';

interface SeededWorkout {
  email: string;
  password: string;
  exerciseId: string;
  programExerciseId: string;
  sessionId: string;
}

async function seedWorkout(page: Page): Promise<SeededWorkout> {
  const password = 'supersecret';
  const email = `e2e-set-durability-${Date.now()}@test.dev`;
  const register = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.61' },
    data: { displayName: 'Set durability E2E', email, password },
  });
  expect(register.ok()).toBeTruthy();

  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Durable Cable Curl',
      muscleGroup: 'BICEPS',
      category: 'ISOLATION',
      equipmentType: 'CABLE',
    },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Durable Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();

  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Durability day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();

  const programExerciseResponse = await page.request.post(
    `/api/workouts/${workout.id}/program-exercises`,
    {
      data: {
        exerciseId: exercise.id,
        targetSets: 4,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRIR: 2,
        restSec: 15,
      },
    },
  );
  expect(programExerciseResponse.ok()).toBeTruthy();
  const programExercise = await programExerciseResponse.json();

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();

  return {
    email,
    password,
    exerciseId: exercise.id,
    programExerciseId: programExercise.id,
    sessionId: session.id,
  };
}

async function skipRestIfVisible(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

test('web sets survive reload/offline and reconcile mobile duplicates without loss', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seedWorkout(page);
  await page.goto(`/session/${seeded.sessionId}`);

  // Let the production PWA claim the page so a navigation can be restored
  // from its NetworkFirst cache while Chromium is offline.
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.ready;
  });
  await page.reload();

  // Ordinary online confirmation is durable before the UI advances and
  // remains visible after an immediate refresh.
  await page.getByRole('button', { name: 'Confirm set 1' }).click();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();

  await page.getByRole('button', { name: 'Confirm set 2' }).click();
  await expect(page.getByTestId('completed-set-2')).toBeVisible();
  await skipRestIfVisible(page);

  // Return calibration currently reduces this new exercise to two effective
  // sets. Temporarily add one future row through the normal set-count control,
  // then commit it while offline.
  await page.getByRole('button', { name: 'Adjust set count' }).click();
  const setControls = page.getByTestId('set-controls-dialog');
  await expect(setControls).toBeVisible();
  await page.getByRole('button', { name: 'Increase total sets' }).click();
  await expect(setControls).toHaveAttribute('aria-busy', 'false');
  await setControls.getByRole('button', { name: 'Close' }).click();
  await expect(setControls).toBeHidden();
  await expect(page.getByRole('button', { name: 'Confirm set 3' })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Confirm set 3' }).click();
  await expect(page.getByTestId('completed-set-3')).toBeVisible();
  await expect(page.getByTestId('set-sync-status-3')).toContainText('Pending sync');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
  await expect(page.getByTestId('completed-set-3')).toBeVisible();
  await expect(page.getByTestId('set-sync-status-3')).toContainText('Pending sync');

  // Completion checks every durable row, including completed overflow, and
  // gives the exact count plus an explicit retry action.
  await page.getByRole('button', { name: 'Manage Durability day' }).click();
  await page.getByRole('button', { name: 'Complete' }).click();
  await page.getByRole('button', { name: 'Finish the session' }).click();
  await expect(
    page.getByText('Cannot finish: 1 pending and 0 failed sets still need server confirmation.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry sets' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to the session' }).click();

  await context.setOffline(false);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/sessions/${seeded.sessionId}`);
      const session = await response.json();
      return session.sets.length;
    })
    .toBe(3);
  await expect(page.getByTestId('set-sync-status-3')).toHaveCount(0);

  const shrinkTarget = await page.request.patch(
    `/api/program-exercises/${seeded.programExerciseId}`,
    { data: { targetSets: 1 } },
  );
  expect(shrinkTarget.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  await expect(page.getByTestId('completed-set-2')).toBeVisible();
  await expect(page.getByTestId('completed-set-3')).toBeVisible();
  await expect(page.getByText('Extra completed set').first()).toBeVisible();

  // Use the real Android sync endpoint to create a second attempt with a
  // duplicate setNumber. Focus reconciliation must show both in completion
  // order, and future numbering must not overwrite either row.
  const mobileLogin = await page.request.post('/api/mobile/auth/login', {
    headers: { 'x-forwarded-for': '10.111.0.62' },
    data: {
      email: seeded.email,
      password: seeded.password,
      deviceId: 'device_e2e_durability',
      deviceName: 'E2E Android',
    },
  });
  expect(mobileLogin.ok()).toBeTruthy();
  const { accessToken } = await mobileLogin.json();
  const mobileSetId = `mob_set_${Date.now()}`;
  const mobileSync = await page.request.post('/api/mobile/sync', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      operations: [
        {
          operationId: `operation_${Date.now()}`,
          type: 'UPSERT_SET',
          set: {
            id: mobileSetId,
            sessionId: seeded.sessionId,
            exerciseId: seeded.exerciseId,
            setNumber: 3,
            weight: 12.5,
            reps: 9,
            rir: 1,
            isWarmup: false,
            isDropSet: false,
            completedAt: new Date().toISOString(),
          },
        },
      ],
    },
  });
  expect(mobileSync.ok()).toBeTruthy();

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('completed-set-4')).toBeVisible();
  await expect(page.getByText('Extra completed set').first()).toBeVisible();

  // Let the focus reconciliation settle and prove the duplicate survives a
  // full remount before changing the target through the UI.
  await page.reload();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  await expect(page.getByTestId('completed-set-2')).toBeVisible();
  await expect(page.getByTestId('completed-set-3')).toBeVisible();
  await expect(page.getByTestId('completed-set-4')).toBeVisible();

  // Completed rows use stable display order even when two clients submitted
  // the same set number. Grow the active target until a fifth display row is
  // available; the next persisted number must be max(setNumber) + 1, not the
  // display position and not a duplicate overwrite.
  const confirmFifth = page.getByRole('button', { name: 'Confirm set 5' });
  for (let attempt = 0; attempt < 6 && !(await confirmFifth.isVisible()); attempt += 1) {
    await page.getByRole('button', { name: 'Adjust set count' }).click();
    await expect(setControls).toBeVisible();
    const totalSets = page.getByTestId('set-count-value');
    const previousTotal = Number(await totalSets.textContent());
    await page.getByRole('button', { name: 'Increase total sets' }).click();
    await expect
      .poll(async () =>
        (await setControls.isVisible()) ? Number(await totalSets.textContent()) : previousTotal + 1,
      )
      .toBeGreaterThan(previousTotal);
    if (await setControls.isVisible()) {
      await expect(setControls).toHaveAttribute('aria-busy', 'false');
      await setControls.getByRole('button', { name: 'Close' }).click();
      await expect(setControls).toBeHidden();
    }
  }
  await expect(confirmFifth).toBeVisible();
  await confirmFifth.click();
  await expect(page.getByTestId('completed-set-5')).toBeVisible();
  await skipRestIfVisible(page);

  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/sessions/${seeded.sessionId}`);
      const session = await response.json();
      const ids = session.sets.map((set: { id: string }) => set.id);
      return {
        count: session.sets.length,
        distinctIds: new Set(ids).size,
        setNumbers: session.sets
          .map((set: { setNumber: number }) => set.setNumber)
          .sort((left: number, right: number) => left - right),
      };
    })
    .toEqual({ count: 5, distinctIds: 5, setNumbers: [1, 2, 3, 3, 4] });

  await page.reload();
  await expect(page.getByTestId('completed-set-1')).toBeVisible();
  await expect(page.getByTestId('completed-set-2')).toBeVisible();
  await expect(page.getByTestId('completed-set-3')).toBeVisible();
  await expect(page.getByTestId('completed-set-4')).toBeVisible();
  await expect(page.getByTestId('completed-set-5')).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/sessions/${seeded.sessionId}`);
      const session = await response.json();
      return {
        count: session.sets.length,
        distinctIds: new Set(session.sets.map((set: { id: string }) => set.id)).size,
        setNumbers: session.sets
          .map((set: { setNumber: number }) => set.setNumber)
          .sort((left: number, right: number) => left - right),
        ids: session.sets.map((set: { id: string }) => set.id).sort(),
      };
    })
    .toMatchObject({
      count: 5,
      distinctIds: 5,
      setNumbers: [1, 2, 3, 3, 4],
      ids: expect.arrayContaining([mobileSetId]),
    });
});
