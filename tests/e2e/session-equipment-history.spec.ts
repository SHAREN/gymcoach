import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

test.use({
  viewport: { width: 390, height: 844 },
  extraHTTPHeaders: { 'x-forwarded-for': '10.111.1.93' },
});

async function createEquipment(page: Page, gymId: string, exerciseId: string, name: string) {
  const response = await page.request.post('/api/gyms/' + gymId + '/equipment', {
    data: {
      name,
      equipmentType: 'MACHINE',
      description: null,
      manufacturer: null,
      modelName: null,
      loadConfigurationKnown: true,
      loadType: 'SELECTORIZED',
      weightOptions: [50, 60, 70, 80, 90, 100, 110, 120],
      exerciseIds: [exerciseId],
      markExercisesAvailable: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.equipment as { id: string; name: string };
}

async function seedScenario(page: Page) {
  const register = await page.request.post('/api/auth/register', {
    data: {
      displayName: 'Equipment History E2E',
      email: 'e2e-equipment-history-' + Date.now() + '@test.dev',
      password: 'supersecret',
    },
  });
  expect(register.ok()).toBeTruthy();

  const exerciseResponse = await page.request.post('/api/exercises', {
    data: {
      name: 'E2E Machine Press History',
      muscleGroup: 'CHEST',
      category: 'COMPOUND',
      equipmentType: 'MACHINE',
    },
  });
  expect(exerciseResponse.ok()).toBeTruthy();
  const exercise = await exerciseResponse.json();

  const gymResponse = await page.request.post('/api/gyms', {
    data: {
      name: 'E2E Equipment History Gym',
      dumbbellWeights: [],
      plateWeights: [],
      barWeights: [],
      exerciseConfigs: [{ exerciseId: exercise.id, isAvailable: true, weightOptions: [] }],
      makeActive: true,
    },
  });
  expect(gymResponse.ok()).toBeTruthy();
  const gym = await gymResponse.json();

  const machineA = await createEquipment(page, gym.id, exercise.id, 'Press A');
  const machineB = await createEquipment(page, gym.id, exercise.id, 'Press B');
  const selection = await page.request.patch('/api/exercises/' + exercise.id + '/equipment', {
    data: {
      gyms: [
        {
          gymId: gym.id,
          equipmentIds: [machineA.id, machineB.id],
          preferredEquipmentId: machineA.id,
        },
      ],
    },
  });
  expect(selection.ok()).toBeTruthy();

  const programResponse = await page.request.post('/api/programs', {
    data: { name: 'E2E Equipment History Program', phase: 'Base' },
  });
  expect(programResponse.ok()).toBeTruthy();
  const program = await programResponse.json();
  const workoutResponse = await page.request.post('/api/programs/' + program.id + '/workouts', {
    data: { name: 'Machine day' },
  });
  expect(workoutResponse.ok()).toBeTruthy();
  const workout = await workoutResponse.json();
  const programmed = await page.request.post('/api/workouts/' + workout.id + '/program-exercises', {
    data: {
      exerciseId: exercise.id,
      targetSets: 3,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetRIR: 2,
      restSec: 90,
    },
  });
  expect(programmed.ok()).toBeTruthy();

  const dbUrl =
    process.env.DATABASE_URL ??
    'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test';
  const sql = new Client({ connectionString: dbUrl });
  await sql.connect();
  const prior: Array<{
    equipment: { id: string };
    weight: number;
    daysAgo: number;
    sessionId?: string;
  }> = [
    { equipment: machineA, weight: 70, daysAgo: 8 },
    { equipment: machineB, weight: 110, daysAgo: 2 },
  ];
  try {
    for (const item of prior) {
      const sessionResponse = await page.request.post('/api/sessions', {
        data: { workoutId: workout.id, gymId: gym.id },
      });
      expect(sessionResponse.ok()).toBeTruthy();
      const historical = await sessionResponse.json();
      item.sessionId = historical.id;
      const setResponse = await page.request.post('/api/sessions/' + historical.id + '/sets', {
        data: {
          exerciseId: exercise.id,
          setNumber: 1,
          weight: item.weight,
          reps: 8,
          rir: 2,
          isWarmup: false,
          isDropSet: false,
          gymEquipmentId: item.equipment.id,
        },
      });
      expect(setResponse.ok()).toBeTruthy();
      const finish = await page.request.put('/api/sessions/' + historical.id, {
        data: { finish: true },
      });
      expect(finish.ok()).toBeTruthy();
      const startedAt = new Date(Date.now() - item.daysAgo * 86400000);
      await sql.query('UPDATE "Session" SET "startedAt" = $1, "finishedAt" = $2 WHERE id = $3', [
        startedAt,
        new Date(startedAt.getTime() + 3600000),
        historical.id,
      ]);
      await sql.query('UPDATE "Set" SET "completedAt" = $1 WHERE "sessionId" = $2', [
        new Date(startedAt.getTime() + 60000),
        historical.id,
      ]);
    }
  } finally {
    await sql.end();
  }

  const currentResponse = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id, gymId: gym.id },
  });
  expect(currentResponse.ok()).toBeTruthy();
  const current = await currentResponse.json();
  return {
    sessionId: current.id as string,
    machineASessionId: prior[0]!.sessionId!,
    machineBSessionId: prior[1]!.sessionId!,
  };
}

test('previous workout and draft follow the selected machine instead of the newest other machine', async ({
  page,
}) => {
  const seeded = await seedScenario(page);
  await page.goto('/session/' + seeded.sessionId);

  const previous = page.getByTestId('previous-session');
  await expect(previous.getByText('Equipment: Press A')).toBeVisible();
  await expect(previous.getByRole('cell', { name: '70 kg' })).toBeVisible();
  await expect(previous.getByText('110 kg')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Full workout' })).toHaveAttribute(
    'href',
    '/history/' + seeded.machineASessionId,
  );

  await page.getByLabel('Equipment').selectOption({ label: 'Press B' });
  await expect(previous.getByText('Equipment: Press B')).toBeVisible();
  await expect(previous.getByRole('cell', { name: '110 kg' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Full workout' })).toHaveAttribute(
    'href',
    '/history/' + seeded.machineBSessionId,
  );
});
