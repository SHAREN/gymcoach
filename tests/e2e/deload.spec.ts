import { test, expect, type Page } from '@playwright/test';

// Dedicated client IP so the UI signup does not share the default register
// rate-limit bucket with other specs (issue #292).
test.use({ extraHTTPHeaders: { 'x-forwarded-for': '10.111.1.3' } });

// One-tap planned deload week (issue #112): the deload recommendation banner
// gains a "Start a deload week" button; while active the banner shows the end
// date and an early-exit button. Data is seeded through the authenticated API
// (the browser context shares cookies with page.request).

async function seedLoggedSet(page: Page) {
  // One exercise, one program/workout, one finished session with a set, so the
  // progress page renders its dashboard (the banner lives inside it).
  const exerciseRes = await page.request.post('/api/exercises', {
    data: { name: 'Deload Bench', muscleGroup: 'CHEST', category: 'COMPOUND' },
  });
  expect(exerciseRes.ok()).toBeTruthy();
  const exercise = await exerciseRes.json();

  const programRes = await page.request.post('/api/programs', {
    data: { name: 'E2E Deload Program', phase: 'Base' },
  });
  expect(programRes.ok()).toBeTruthy();
  const program = await programRes.json();

  const workoutRes = await page.request.post(`/api/programs/${program.id}/workouts`, {
    data: { name: 'Day A' },
  });
  expect(workoutRes.ok()).toBeTruthy();
  const workout = await workoutRes.json();

  const sessionRes = await page.request.post('/api/sessions', {
    data: { workoutId: workout.id },
  });
  expect(sessionRes.ok()).toBeTruthy();
  const session = await sessionRes.json();

  const setRes = await page.request.post(`/api/sessions/${session.id}/sets`, {
    data: { exerciseId: exercise.id, setNumber: 1, weight: 90, reps: 5 },
  });
  expect(setRes.ok()).toBeTruthy();

  const finishRes = await page.request.put(`/api/sessions/${session.id}`, {
    data: { finish: true },
  });
  expect(finishRes.ok()).toBeTruthy();
}

async function seedLowReadiness(page: Page) {
  // Three drained check-ins trigger the chronic low-readiness deload
  // recommendation (average 1 over >= 3 recent check-ins).
  for (let i = 0; i < 3; i += 1) {
    const res = await page.request.post('/api/readiness', {
      data: { readiness: 1, sleepQuality: 1 },
    });
    expect(res.ok()).toBeTruthy();
  }
}

test('a lifter can start a planned deload week from the banner and end it early', async ({
  page,
}) => {
  // Register through the authenticated API. Auth UI itself is covered by
  // auth.spec.ts; this feature spec should not depend on signup rendering
  // latency while many Chromium workers seed accounts in parallel.
  const registerRes = await page.request.post('/api/auth/register', {
    data: {
      displayName: 'Deload E2E',
      email: 'e2e-deload-' + Date.now() + '@test.dev',
      password: 'supersecret',
    },
  });
  expect(registerRes.ok()).toBeTruthy();

  await seedLoggedSet(page);
  await seedLowReadiness(page);

  // The recommendation banner shows with the one-tap action.
  await page.goto('/progress');
  await expect(page.getByText('A deload week looks due')).toBeVisible();
  await page.getByRole('button', { name: 'Start a deload week' }).click();

  // Active state: end date copy and the early-exit button.
  await expect(page.getByText('Deload week in progress')).toBeVisible();
  await expect(page.getByText(/Until /)).toBeVisible();
  await expect(page.getByText('A deload week looks due')).not.toBeVisible();

  // End it early: the banner falls back to the recommendation (the low
  // readiness signals are still present).
  await page.getByRole('button', { name: 'End deload now' }).click();
  await expect(page.getByText('A deload week looks due')).toBeVisible();
  await expect(page.getByText('Deload week in progress')).not.toBeVisible();
});
