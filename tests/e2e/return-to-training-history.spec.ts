import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function seedLongTermBenchHistory(page: Page) {
  const password = 'supersecret';
  const email = `e2e-return-history-${Date.now()}@test.dev`;
  const register = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.91' },
    data: { displayName: 'Return history E2E', email, password },
  });
  expect(register.ok()).toBeTruthy();

  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Long History Bench Press',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'BARBELL',
    },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const gymResponse = await page.request.post('/api/gyms', {
    data: { name: 'E2E Return Gym', inventoryMode: 'EQUIPMENT_FIRST', makeActive: true },
  });
  expect(gymResponse.ok()).toBeTruthy();
  const gym = await gymResponse.json();
  const equipmentResponse = await page.request.post(`/api/gyms/${gym.id}/equipment`, {
    data: {
      name: 'E2E Bench Station',
      equipmentType: 'BARBELL',
      loadType: 'FIXED',
      weightOptions: [20, 40, 50, 60, 70, 80],
      exerciseIds: [exercise.id],
    },
  });
  expect(equipmentResponse.ok()).toBeTruthy();
  const equipment = (await equipmentResponse.json()).equipment;

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Return Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();
  const workoutResponse = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Bench return day' },
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
        restSec: 120,
      },
    },
  );
  expect(programExerciseResponse.ok()).toBeTruthy();

  const mobileLogin = await page.request.post('/api/mobile/auth/login', {
    headers: { 'x-forwarded-for': '10.111.0.92' },
    data: {
      email,
      password,
      deviceId: `device_return_${Date.now()}`,
      deviceName: 'E2E history seeder',
    },
  });
  expect(mobileLogin.ok()).toBeTruthy();
  const { accessToken } = await mobileLogin.json();
  const now = Date.now();
  const operations = [180, 210, 240].flatMap((age, index) => {
    const startedAt = new Date(now - age * 86_400_000);
    const sessionId = `e2e_return_session_${now}_${index}`;
    return [
      {
        operationId: `e2e_return_start_${now}_${index}`,
        type: 'START_SESSION',
        session: {
          id: sessionId,
          workoutId: workout.id,
          gymId: gym.id,
          startedAt: startedAt.toISOString(),
        },
      },
      {
        operationId: `e2e_return_set_${now}_${index}`,
        type: 'UPSERT_SET',
        set: {
          id: `e2e_return_set_row_${now}_${index}`,
          sessionId,
          exerciseId: exercise.id,
          gymEquipmentId: equipment.id,
          setNumber: 1,
          weight: [60, 70, 80][index],
          reps: 8,
          rir: 2,
          isWarmup: false,
          isDropSet: false,
          completedAt: new Date(startedAt.getTime() + 60_000).toISOString(),
        },
      },
      {
        operationId: `e2e_return_finish_${now}_${index}`,
        type: 'FINISH_SESSION',
        sessionId,
        finishedAt: new Date(startedAt.getTime() + 3_600_000).toISOString(),
      },
    ];
  });
  const syncResponse = await page.request.post('/api/mobile/sync', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { operations },
  });
  expect(syncResponse.ok()).toBeTruthy();

  const sessionResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json();
  return { sessionId: session.id as string };
}

test('a 60-80 kg exact bench history produces a bounded explained return load instead of 20 kg', async ({
  page,
}) => {
  const { sessionId } = await seedLongTermBenchHistory(page);
  await page.goto(`/session/${sessionId}`);

  const notice = page.getByTestId('return-to-training-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('History confidence: low.');
  await expect(notice).toContainText(
    'No recent exact-equipment session is available. The load anchor uses 3 older exact-equipment session(s).',
  );
  await expect(notice).toContainText('Conservative starting load: 40 kg.');
  await expect(notice).toContainText('Sets today: 1. Target RIR: 4.');
  await expect(page.getByRole('button', { name: 'Set 1 weight in KG' })).toHaveText('40');
});
