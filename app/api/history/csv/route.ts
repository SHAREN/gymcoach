import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, requireApiUserId } from '@/lib/api';
import { csvEscape, HISTORY_CSV_HEADERS } from '@/lib/csv';
import { effectiveWeight, estimate1RM, setVolume } from '@/lib/stats';
import {
  dateKeyInTimeZone,
  getMonthQueryRange,
  isValidTimeZone,
  parseMonthKey,
} from '@/lib/history-calendar';

// GET /api/history/csv?programId=...&month=YYYY-MM&timeZone=Europe/Moscow
// Returns a CSV (UTF-8 + BOM for Excel) with one row per set, including
// warmups flagged by is_warmup. The visible calendar month is interpreted in
// the browser's IANA timezone. The GymCoach CSV import is the symmetric inverse
// of this export.
export async function GET(req: Request) {
  try {
    const userId = await requireApiUserId();
    const url = new URL(req.url);
    const programId = url.searchParams.get('programId');
    const month = url.searchParams.get('month');
    const requestedTimeZone = url.searchParams.get('timeZone');
    const timeZone = isValidTimeZone(requestedTimeZone) ? requestedTimeZone : 'UTC';
    const validMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : null;

    const where: Record<string, unknown> = {
      userId,
      finishedAt: { not: null },
    };
    if (programId) where.programId = programId;
    if (validMonth) {
      where.startedAt = getMonthQueryRange(parseMonthKey(validMonth));
    }

    const [queriedSessions, user] = await Promise.all([
      db.session.findMany({
        where,
        orderBy: { startedAt: 'asc' },
        include: {
          program: { select: { name: true } },
          workout: { select: { name: true } },
          sets: {
            orderBy: [{ exerciseId: 'asc' }, { setNumber: 'asc' }],
            include: {
              exercise: {
                select: { name: true, muscleGroup: true, usesBodyweight: true },
              },
            },
          },
        },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { bodyweight: true },
      }),
    ]);
    const bodyweight = user?.bodyweight ?? null;
    const sessions = validMonth
      ? queriedSessions.filter((session) =>
          dateKeyInTimeZone(session.startedAt, timeZone).startsWith(`${validMonth}-`),
        )
      : queriedSessions;

    const lines: string[] = [HISTORY_CSV_HEADERS.join(',')];

    for (const session of sessions) {
      const durationMin = session.finishedAt
        ? Math.round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000)
          : '';
      const dateOnly = dateKeyInTimeZone(session.startedAt, timeZone);
      for (const set of session.sets) {
        const effective = effectiveWeight(
          set.weight,
          set.exercise.usesBodyweight,
          bodyweight,
        );
        const effectiveSet = {
          weight: effective,
          reps: set.reps,
          isWarmup: set.isWarmup,
        };
        const row = [
          session.id,
          dateOnly,
          session.startedAt.toISOString(),
          session.finishedAt?.toISOString() ?? '',
          String(durationMin),
          session.program?.name ?? '',
          session.workout?.name ?? '',
          set.exercise.name,
          set.exercise.muscleGroup,
          set.exercise.usesBodyweight ? 'true' : 'false',
          String(set.setNumber),
          String(set.weight),
          String(effective),
          String(set.reps),
          set.rir != null ? String(set.rir) : '',
          set.isWarmup ? 'true' : 'false',
          set.isDropSet ? 'true' : 'false',
          String(setVolume(effectiveSet)),
          set.isWarmup ? '' : estimate1RM(effective, set.reps).toFixed(2),
          set.notes ?? '',
          set.durationSec != null ? String(set.durationSec) : '',
          set.distanceM != null ? String(set.distanceM) : '',
          set.avgHr != null ? String(set.avgHr) : '',
          set.maxHr != null ? String(set.maxHr) : '',
        ];
        lines.push(row.map(csvEscape).join(','));
      }
    }

    const body = '﻿' + lines.join('\n');
    const filename = buildFilename(validMonth, programId);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function buildFilename(month: string | null, programId: string | null): string {
  const parts = ['gymcoach-history'];
  if (month) parts.push(month);
  if (programId) parts.push(`prog-${programId.slice(0, 8)}`);
  if (parts.length === 1) parts.push(new Date().toISOString().slice(0, 10));
  return parts.join('-') + '.csv';
}
