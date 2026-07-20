import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import {
  GYMCOACH_JSON_MAX_BYTES,
  parseGymcoachCsv,
  type GymcoachCsvRow,
} from '@/lib/import/gymcoach-csv';
import {
  buildGymcoachImportPlan,
  executeGymcoachImport,
  loadGymcoachImportSnapshot,
  type GymcoachImportPlan,
} from '@/lib/import/gymcoach-import';
import { rateLimit } from '@/lib/rate-limit';
import { gymcoachImportInputSchema } from '@/lib/schemas/import';

const MAX_REPORTED_ERRORS = 50;
function responseCommon(
  plan: GymcoachImportPlan,
  parserErrors: Array<{ line: number; reason: string }>,
) {
  const errors = [...parserErrors, ...plan.errors].sort((left, right) => left.line - right.line);
  return {
    duplicatesSkipped: plan.duplicateCount,
    cardioSets: plan.cardioSetCount,
    cardioSkipped: 0,
    errorCount: errors.length,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
  };
}

async function planImport(
  client: Parameters<typeof loadGymcoachImportSnapshot>[0],
  userId: string,
  rows: GymcoachCsvRow[],
) {
  const snapshot = await loadGymcoachImportSnapshot(client, userId, rows);
  return buildGymcoachImportPlan(userId, rows, snapshot);
}

// POST /api/import/gymcoach imports the current timezone-aware native history
// CSV. Preview is read-only. Confirm serializes on the authenticated user row,
// rebuilds its plan inside the transaction, and writes complete source
// sessions only. Deterministic source-session IDs make an exact concurrent or
// repeated confirm a successful no-op instead of a duplicate.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId(req);
    const rl = rateLimit(`import:${userId}`, 10, 60_000);
    if (!rl.ok) {
      throw new ApiError(429, `Too many import requests. Retry in ${rl.retryAfterSec}s.`);
    }

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > GYMCOACH_JSON_MAX_BYTES) {
      throw new ApiError(413, 'Request body too large.');
    }

    const data = await parseJsonBody(req, gymcoachImportInputSchema, {
      maxBytes: GYMCOACH_JSON_MAX_BYTES,
    });
    const parsed = parseGymcoachCsv(data.csv);
    if (!parsed.ok) {
      throw new ApiError(400, parsed.fatalError ?? 'Unreadable file.');
    }

    if (data.mode === 'preview') {
      const plan = await planImport(db, userId, parsed.rows);
      return NextResponse.json({
        mode: 'preview',
        sessions: plan.sessions.length,
        sets: plan.totalSets,
        newExercises: plan.newExercises.map((exercise) => exercise.name),
        existingSessionDates: plan.existingSessionDates,
        ...responseCommon(plan, parsed.errors),
      });
    }

    const confirmed = await db.$transaction(
      async (tx) => {
        // All GymCoach native confirms for one user serialize here. Planning
        // occurs only after the lock, so a concurrent loser observes the
        // winner and returns zero created rows.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        const plan = await planImport(tx, userId, parsed.rows);
        const result = await executeGymcoachImport(tx, userId, plan);
        return { plan, result };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return NextResponse.json({
      mode: 'confirm',
      ...confirmed.result,
      ...responseCommon(confirmed.plan, parsed.errors),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
