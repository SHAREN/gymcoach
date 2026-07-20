import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { getCurrentUserId } from '@/lib/auth';
import { csvEscape, HISTORY_CSV_HEADERS } from '@/lib/csv';
import { effectiveWeight } from '@/lib/stats';
import { resetRateLimits } from '@/lib/rate-limit';
import { POST as postImport } from '@/app/api/import/gymcoach/route';
import { GYMCOACH_JSON_MAX_BYTES } from '@/lib/import/gymcoach-csv';
import { GET as getCsv } from '@/app/api/history/csv/route';

vi.mock('@/lib/auth', () => ({ getCurrentUserId: vi.fn() }));
const mockUserId = vi.mocked(getCurrentUserId);

type Header = (typeof HISTORY_CSV_HEADERS)[number];

const baseRow: Record<Header, string> = {
  session_id: 'source-session-1',
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
  external_load_kg: '80',
  effective_weight_kg: '80',
  reps: '8',
  rir: '2',
  is_warmup: 'false',
  is_drop_set: 'false',
  volume_kg: '640',
  estimated_1rm_kg: '101.28',
  set_notes: '',
  duration_sec: '',
  distance_m: '',
  avg_hr: '',
  max_hr: '',
  session_timezone: 'UTC',
  session_set_count: '1',
  exercise_category: 'COMPOUND',
};

function nativeRow(over: Partial<Record<Header, string>> = {}): string {
  const cells = { ...baseRow, ...over };
  return HISTORY_CSV_HEADERS.map((name) => csvEscape(cells[name])).join(',');
}

function nativeCsv(...rows: string[]): string {
  return '﻿' + [HISTORY_CSV_HEADERS.join(','), ...rows].join('\n');
}

function importReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://test.local/api/import/gymcoach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function seedUser(email: string, bodyweight?: number) {
  return db.user.create({ data: { email, passwordHash: 'x', bodyweight } });
}

function actAs(userId: string | null) {
  mockUserId.mockResolvedValue(userId);
}

beforeEach(() => {
  mockUserId.mockReset();
  resetRateLimits();
});

describe('POST /api/import/gymcoach - preview and validation', () => {
  it('previews two identical same-day source sessions without writing', async () => {
    const user = await seedUser('gymcoach-preview@test.dev');
    actAs(user.id);
    const csv = nativeCsv(nativeRow(), nativeRow({ session_id: 'source-session-2' }));

    const response = await postImport(importReq({ csv, mode: 'preview' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: 'preview',
      sessions: 2,
      sets: 2,
      newExercises: ['Bench Press'],
      duplicatesSkipped: 0,
      errorCount: 0,
    });
    expect(await db.session.count()).toBe(0);
    expect(await db.set.count()).toBe(0);
    expect(await db.exercise.count()).toBe(0);
  });

  it('reports existing exercise semantic conflicts line-by-line and plans no writes', async () => {
    const user = await seedUser('gymcoach-conflict@test.dev');
    await db.exercise.create({
      data: {
        userId: user.id,
        name: 'bench press',
        muscleGroup: 'CHEST',
        category: 'ISOLATION',
      },
    });
    actAs(user.id);

    const response = await postImport(importReq({ csv: nativeCsv(nativeRow()), mode: 'preview' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ sessions: 0, sets: 0, errorCount: 1 });
    expect(body.errors[0]).toMatchObject({ line: 2 });
    expect(body.errors[0].reason).toMatch(/incompatible/i);
  });

  it('requires authentication and rejects an oversized declared body', async () => {
    actAs(null);
    const unauthorized = await postImport(
      importReq({ csv: nativeCsv(nativeRow()), mode: 'preview' }),
    );
    expect(unauthorized.status).toBe(401);

    const user = await seedUser('gymcoach-size@test.dev');
    actAs(user.id);
    const oversized = await postImport(
      importReq(
        { csv: nativeCsv(nativeRow()), mode: 'preview' },
        { 'content-length': String(GYMCOACH_JSON_MAX_BYTES + 1) },
      ),
    );
    expect(oversized.status).toBe(413);
  });

  it('shares the per-user import rate limit', async () => {
    const user = await seedUser('gymcoach-rate@test.dev');
    actAs(user.id);
    const csv = nativeCsv(nativeRow());
    for (let index = 0; index < 10; index++) {
      const response = await postImport(importReq({ csv, mode: 'preview' }));
      expect(response.status).toBe(200);
    }
    const limited = await postImport(importReq({ csv, mode: 'preview' }));
    expect(limited.status).toBe(429);
  });
});

describe('POST /api/import/gymcoach - confirm integrity', () => {
  it('preserves bodyweight/category/muscle metadata and cardio set semantics', async () => {
    const user = await seedUser('gymcoach-semantics@test.dev', 80);
    actAs(user.id);
    const csv = nativeCsv(
      nativeRow({
        exercise: 'Weighted Pull-up',
        muscle_group: 'BACK_WIDTH',
        uses_bodyweight: 'true',
        external_load_kg: '20',
      }),
      nativeRow({
        session_id: 'source-session-2',
        workout: 'Run',
        exercise: 'Running',
        muscle_group: 'OTHER',
        exercise_category: 'CARDIO',
        external_load_kg: '0',
        effective_weight_kg: '0',
        reps: '1',
        rir: '',
        volume_kg: '0',
        estimated_1rm_kg: '',
        duration_sec: '1800',
        distance_m: '5000',
        avg_hr: '150',
        max_hr: '172',
      }),
    );

    const response = await postImport(importReq({ csv, mode: 'confirm' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      createdSessions: 2,
      createdSets: 2,
      createdExercises: 2,
      cardioSets: 1,
      errorCount: 0,
    });

    const exercises = await db.exercise.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
    });
    expect(exercises).toMatchObject([
      {
        name: 'Running',
        muscleGroup: 'OTHER',
        category: 'CARDIO',
        usesBodyweight: false,
        equipmentType: 'CARDIO',
      },
      {
        name: 'Weighted Pull-up',
        muscleGroup: 'BACK_WIDTH',
        category: 'COMPOUND',
        usesBodyweight: true,
        equipmentType: 'BODYWEIGHT',
      },
    ]);
    const weightedSet = await db.set.findFirstOrThrow({
      where: { exercise: { name: 'Weighted Pull-up' } },
      include: { exercise: true },
    });
    expect(weightedSet.weight).toBe(20);
    expect(effectiveWeight(weightedSet.weight, weightedSet.exercise.usesBodyweight, 80)).toBe(100);
    const cardioSet = await db.set.findFirstOrThrow({
      where: { exercise: { name: 'Running' } },
    });
    expect(cardioSet).toMatchObject({
      weight: 0,
      reps: 1,
      durationSec: 1800,
      distanceM: 5000,
      avgHr: 150,
      maxHr: 172,
    });
  });

  it('makes an identical re-import a successful zero-write no-op', async () => {
    const user = await seedUser('gymcoach-idempotent@test.dev');
    actAs(user.id);
    const csv = nativeCsv(nativeRow());

    const first = await postImport(importReq({ csv, mode: 'confirm' }));
    const second = await postImport(importReq({ csv, mode: 'confirm' }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      createdSessions: 0,
      createdSets: 0,
      createdExercises: 0,
      duplicatesSkipped: 1,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(1);
  });

  it('preserves repeated set numbers from a valid native export', async () => {
    const user = await seedUser('gymcoach-repeated-set@test.dev');
    actAs(user.id);
    const csv = nativeCsv(
      nativeRow({ session_set_count: '2' }),
      nativeRow({ session_set_count: '2' }),
    );

    const response = await postImport(importReq({ csv, mode: 'confirm' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ createdSessions: 1, createdSets: 2 });
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(2);
  });

  it.each([
    ['valid row before malformed sibling', false],
    ['malformed row before valid sibling', true],
  ])('writes nothing for a reused count-1 source ID with a %s', async (_, malformedFirst) => {
    const user = await seedUser(`gymcoach-atomic-malformed-${malformedFirst}@test.dev`);
    actAs(user.id);
    const valid = nativeRow({
      session_id: 'ambiguous-source',
      session_date: '2026-03-02',
      session_started_at: '2026-03-02T09:00:00Z',
      session_finished_at: '2026-03-02T10:00:00Z',
      session_set_count: '1',
    });
    const malformed = nativeRow({
      session_id: 'ambiguous-source',
      session_date: '2026-03-02',
      session_started_at: '2026-02-30T09:00:00Z',
      session_finished_at: '2026-03-02T10:00:00Z',
      session_set_count: '1',
    });
    const csv = nativeCsv(...(malformedFirst ? [malformed, valid] : [valid, malformed]));

    const response = await postImport(importReq({ csv, mode: 'confirm' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      mode: 'confirm',
      createdSessions: 0,
      createdSets: 0,
      createdExercises: 0,
      duplicatesSkipped: 0,
      errorCount: 2,
    });
    expect(body.errors.map((error: { line: number }) => error.line)).toEqual([2, 3]);
    const malformedLine = malformedFirst ? 2 : 3;
    const validLine = malformedFirst ? 3 : 2;
    expect(
      body.errors.find((error: { line: number }) => error.line === malformedLine)?.reason,
    ).toMatch(/startedAtIso/);
    expect(body.errors.find((error: { line: number }) => error.line === validLine)?.reason).toMatch(
      /Source session skipped/,
    );
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(0);
    expect(await db.exercise.count({ where: { userId: user.id } })).toBe(0);
  });

  it('serializes concurrent confirms and creates exactly one copy', async () => {
    const user = await seedUser('gymcoach-concurrent@test.dev');
    actAs(user.id);
    const csv = nativeCsv(nativeRow());

    const [left, right] = await Promise.all([
      postImport(importReq({ csv, mode: 'confirm' })),
      postImport(importReq({ csv, mode: 'confirm' })),
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    const bodies = await Promise.all([left.json(), right.json()]);
    expect(bodies.map((body) => body.createdSessions).sort()).toEqual([0, 1]);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(1);
  });

  it('never treats another user source ID or exercise as owned data', async () => {
    const owner = await seedUser('gymcoach-owner@test.dev');
    const importer = await seedUser('gymcoach-importer@test.dev');
    const otherExercise = await db.exercise.create({
      data: {
        userId: owner.id,
        name: 'Bench Press',
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    await db.session.create({
      data: {
        id: 'source-session-1',
        userId: owner.id,
        startedAt: new Date(baseRow.session_started_at),
        finishedAt: new Date(baseRow.session_finished_at),
        sets: {
          create: {
            exerciseId: otherExercise.id,
            setNumber: 1,
            weight: 80,
            reps: 8,
            rir: 2,
          },
        },
      },
    });
    actAs(importer.id);

    const response = await postImport(importReq({ csv: nativeCsv(nativeRow()), mode: 'confirm' }));
    expect(response.status).toBe(200);
    expect(await db.session.count({ where: { userId: importer.id } })).toBe(1);
    expect(await db.exercise.count({ where: { userId: importer.id } })).toBe(1);
    expect(await db.set.count({ where: { session: { userId: owner.id } } })).toBe(1);
  });

  it('rolls back sessions, sets and exercises when a database write fails', async () => {
    const user = await seedUser('gymcoach-rollback@test.dev');
    actAs(user.id);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION reject_gymcoach_import_set()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW."weight" = 499 THEN
          RAISE EXCEPTION 'injected GymCoach import failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER reject_gymcoach_import_set_trigger
      BEFORE INSERT ON "Set"
      FOR EACH ROW
      EXECUTE FUNCTION reject_gymcoach_import_set()
    `);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const csv = nativeCsv(
        nativeRow({ session_set_count: '2', exercise: 'Bench', set_number: '1' }),
        nativeRow({
          session_set_count: '2',
          exercise: 'Curl',
          muscle_group: 'BICEPS',
          exercise_category: 'ISOLATION',
          set_number: '1',
          external_load_kg: '499',
        }),
      );
      const response = await postImport(importReq({ csv, mode: 'confirm' }));
      expect(response.status).toBe(500);
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await db.set.count({ where: { session: { userId: user.id } } })).toBe(0);
      expect(await db.exercise.count({ where: { userId: user.id } })).toBe(0);
    } finally {
      errorSpy.mockRestore();
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_gymcoach_import_set_trigger ON "Set"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS reject_gymcoach_import_set()');
    }
  });
});

describe('GymCoach export/import round trip', () => {
  it.each([
    {
      label: 'Los Angeles previous day',
      timeZone: 'America/Los_Angeles',
      startedAt: '2026-05-01T00:30:00.000Z',
      expectedDate: '2026-04-30',
    },
    {
      label: 'Yekaterinburg next day',
      timeZone: 'Asia/Yekaterinburg',
      startedAt: '2026-04-30T21:30:00.000Z',
      expectedDate: '2026-05-01',
    },
  ])('preserves $label and stays idempotent', async ({ timeZone, startedAt, expectedDate }) => {
    const exporter = await seedUser(`export-${timeZone.replace('/', '-')}@test.dev`);
    const exercise = await db.exercise.create({
      data: {
        userId: exporter.id,
        name: "''=Bench, Press",
        muscleGroup: 'CHEST',
        category: 'COMPOUND',
      },
    });
    const session = await db.session.create({
      data: {
        userId: exporter.id,
        startedAt: new Date(startedAt),
        finishedAt: new Date(new Date(startedAt).getTime() + 30 * 60 * 1000),
        sets: {
          create: {
            exerciseId: exercise.id,
            setNumber: 1,
            weight: 100,
            reps: 5,
            notes: '=literal note',
          },
        },
      },
    });
    actAs(exporter.id);
    const exported = await getCsv(
      new Request(`http://test.local/api/history/csv?timeZone=${encodeURIComponent(timeZone)}`),
    );
    expect(exported.status).toBe(200);
    const csv = await exported.text();
    expect(csv).toContain(expectedDate);
    expect(csv).toContain(timeZone);

    // Re-import into the source account recognizes the owned Session.id.
    const self = await postImport(importReq({ csv, mode: 'confirm' }));
    expect(self.status).toBe(200);
    expect(await self.json()).toMatchObject({ createdSessions: 0, duplicatesSkipped: 1 });
    expect(await db.session.count({ where: { userId: exporter.id } })).toBe(1);

    const importer = await seedUser(`import-${timeZone.replace('/', '-')}@test.dev`);
    actAs(importer.id);
    const first = await postImport(importReq({ csv, mode: 'confirm' }));
    const second = await postImport(importReq({ csv, mode: 'confirm' }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ createdSessions: 1, createdSets: 1 });
    expect(await second.json()).toMatchObject({ createdSessions: 0, duplicatesSkipped: 1 });

    const imported = await db.session.findFirstOrThrow({
      where: { userId: importer.id },
      include: { sets: { include: { exercise: true } } },
    });
    expect(imported.startedAt.toISOString()).toBe(startedAt);
    expect(imported.sets[0]?.exercise.name).toBe("''=Bench, Press");
    expect(imported.sets[0]?.notes).toBe('=literal note');
    expect(session.id).not.toBe(imported.id);
  });
});
