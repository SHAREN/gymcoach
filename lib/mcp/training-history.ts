import { db } from '@/lib/db';
import type { Prisma } from '@/lib/prisma-client';

const historySessionInclude = {
  program: { select: { id: true, name: true } },
  workout: { select: { id: true, name: true } },
  gym: { select: { id: true, name: true } },
  sets: {
    orderBy: [
      { completedAt: 'asc' as const },
      { setNumber: 'asc' as const },
      { id: 'asc' as const },
    ],
    include: {
      exercise: {
        select: {
          id: true,
          name: true,
          muscleGroup: true,
          category: true,
          equipmentType: true,
          usesBodyweight: true,
        },
      },
      gymEquipment: {
        select: { id: true, name: true, equipmentType: true },
      },
    },
  },
} satisfies Prisma.SessionInclude;

export type McpTrainingHistorySession = Prisma.SessionGetPayload<{
  include: typeof historySessionInclude;
}>;

export interface McpTrainingHistoryQuery {
  programId?: string;
  from?: Date;
  to: Date;
  limit: number;
  cursorSessionId?: string;
}

export async function getMcpTrainingHistory(userId: string, query: McpTrainingHistoryQuery) {
  if (query.cursorSessionId) {
    const ownedCursor = await db.session.findFirst({
      where: { id: query.cursorSessionId, userId },
      select: { id: true },
    });
    if (!ownedCursor) throw new Error('History cursor session not found.');
  }

  const where: Prisma.SessionWhereInput = {
    userId,
    ...(query.programId ? { programId: query.programId } : {}),
    startedAt: {
      ...(query.from ? { gte: query.from } : {}),
      lte: query.to,
    },
  };

  const [totalMatching, page] = await Promise.all([
    db.session.count({ where }),
    db.session.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursorSessionId ? { cursor: { id: query.cursorSessionId }, skip: 1 } : {}),
      take: query.limit + 1,
      include: historySessionInclude,
    }),
  ]);

  const hasMore = page.length > query.limit;
  const rows = page.slice(0, query.limit);
  const sessions = rows.map(serializeMcpTrainingSession);

  return {
    range: {
      from: query.from?.toISOString() ?? null,
      to: query.to.toISOString(),
      programId: query.programId ?? null,
    },
    totalMatching,
    returned: sessions.length,
    hasMore,
    nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
    summaryOfReturnedSessions: summarizeReturnedSessions(rows),
    sessions,
  };
}

export function serializeMcpTrainingSession(session: McpTrainingHistorySession) {
  const grouped = new Map<
    string,
    {
      exercise: McpTrainingHistorySession['sets'][number]['exercise'];
      sets: McpTrainingHistorySession['sets'];
    }
  >();

  for (const set of session.sets) {
    const current = grouped.get(set.exerciseId);
    if (current) current.sets.push(set);
    else grouped.set(set.exerciseId, { exercise: set.exercise, sets: [set] });
  }

  return {
    sessionId: session.id,
    program: session.program,
    workout: session.workout,
    gym: session.gym,
    startedAt: session.startedAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    durationMin:
      session.finishedAt == null
        ? null
        : round((session.finishedAt.getTime() - session.startedAt.getTime()) / 60000, 1),
    notes: session.notes,
    exercises: [...grouped.values()].map(({ exercise, sets }) => ({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      muscleGroup: exercise.muscleGroup,
      category: exercise.category,
      equipmentType: exercise.equipmentType,
      usesBodyweight: exercise.usesBodyweight,
      sets: sets.map((set) => ({
        setId: set.id,
        setNumber: set.setNumber,
        weightKg: set.weight,
        reps: set.reps,
        rir: set.rir,
        isWarmup: set.isWarmup,
        isDropSet: set.isDropSet,
        durationSec: set.durationSec,
        distanceM: set.distanceM,
        avgHr: set.avgHr,
        maxHr: set.maxHr,
        notes: set.notes,
        completedAt: set.completedAt.toISOString(),
        equipment: set.gymEquipment
          ? {
              id: set.gymEquipment.id,
              name: set.gymEquipment.name,
              equipmentType: set.gymEquipment.equipmentType,
            }
          : set.equipmentNameSnapshot
            ? { id: null, name: set.equipmentNameSnapshot, equipmentType: null }
            : null,
        equipmentLoadSnapshot: set.equipmentLoadSnapshot,
      })),
    })),
  };
}

function summarizeReturnedSessions(sessions: McpTrainingHistorySession[]) {
  let strengthWorkingSets = 0;
  let cardioSets = 0;
  let setsWithRir = 0;

  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.exercise.category === 'CARDIO') {
        cardioSets += 1;
        continue;
      }
      if (set.isWarmup) continue;
      strengthWorkingSets += 1;
      if (set.rir != null) setsWithRir += 1;
    }
  }

  return {
    sessions: sessions.length,
    strengthWorkingSets,
    cardioSets,
    setsWithRir,
    rirCoveragePct:
      strengthWorkingSets > 0 ? round((setsWithRir / strengthWorkingSets) * 100, 1) : null,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
