import { expect, test } from '@playwright/test';
import { csvEscape, HISTORY_CSV_HEADERS } from '../../lib/csv';

type Header = (typeof HISTORY_CSV_HEADERS)[number];

const baseRow: Record<Header, string> = {
  session_id: 'e2e-source-1',
  session_date: '2026-05-02',
  session_started_at: '2026-05-02T09:13:00.000Z',
  session_finished_at: '2026-05-02T10:05:00.000Z',
  duration_min: '52',
  program: '',
  workout: 'Push Day',
  exercise: 'Bench Press',
  muscle_group: 'CHEST',
  uses_bodyweight: 'false',
  set_number: '1',
  external_load_kg: '40',
  effective_weight_kg: '40',
  reps: '8',
  rir: '',
  is_warmup: 'true',
  is_drop_set: 'false',
  volume_kg: '320',
  estimated_1rm_kg: '',
  set_notes: '',
  duration_sec: '',
  distance_m: '',
  avg_hr: '',
  max_hr: '',
  session_timezone: 'UTC',
  session_set_count: '3',
  exercise_category: 'COMPOUND',
};

function row(over: Partial<Record<Header, string>> = {}): string {
  const cells = { ...baseRow, ...over };
  return HISTORY_CSV_HEADERS.map((name) => csvEscape(cells[name])).join(',');
}

const GYMCOACH_CSV = [
  HISTORY_CSV_HEADERS.join(','),
  row(),
  row({
    set_number: '2',
    external_load_kg: '80',
    effective_weight_kg: '80',
    rir: '2',
    is_warmup: 'false',
    volume_kg: '640',
    estimated_1rm_kg: '101.28',
  }),
  row({
    set_number: '3',
    external_load_kg: '80',
    effective_weight_kg: '80',
    reps: '7',
    rir: '1',
    is_warmup: 'false',
    volume_kg: '560',
    estimated_1rm_kg: '98.67',
  }),
  row({
    session_id: 'e2e-bad',
    session_set_count: '1',
    session_date: 'not-a-date',
  }),
].join('\n');

test('a lifter can preview and confirm an atomic GymCoach CSV import', async ({ page }) => {
  const register = await page.request.post('/api/auth/register', {
    headers: { 'x-forwarded-for': '10.111.0.6' },
    data: {
      displayName: 'GymCoach CSV E2E',
      email: `e2e-gymcoach-csv-${Date.now()}@test.dev`,
      password: 'supersecret',
    },
  });
  expect(register.ok()).toBeTruthy();

  await page.goto('/settings');
  await page.getByLabel('Source app').click();
  await page.getByRole('option', { name: 'GymCoach CSV' }).click();
  await expect(page.getByText('Import from GymCoach')).toBeVisible();
  await expect(page.getByText(/Each source session is imported atomically/)).toBeVisible();
  await expect(page.getByText('Strong weight unit')).not.toBeVisible();

  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({
    name: 'gymcoach-history.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(GYMCOACH_CSV, 'utf8'),
  });

  const preview = page.getByTestId('import-preview');
  await expect(preview).toContainText('1 session, 3 sets to import');
  await expect(preview).toContainText('1 new exercise will be created: Bench Press');
  await expect(preview).toContainText('Line 5');

  await page.getByRole('button', { name: /confirm import/i }).click();
  await expect(preview).not.toBeVisible();

  await page.goto('/history?month=2026-05&day=2026-05-02');
  await expect(page.getByRole('button', { name: /May 2, 2026\. 1 workout/ })).toBeVisible();
  await expect(page.getByText('2 sets')).toBeVisible();
});
