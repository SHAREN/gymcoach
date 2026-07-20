import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, requireApiUserId } from '@/lib/api';
import { buildCoachPayload, callCoach } from '@/lib/coach';
import { LlmError } from '@/lib/llm';
import { isoWeekStart } from '@/lib/stats';

// POST /api/coach: generates a new debrief for the current week.
// The structured payload is computed server-side then sent to the configured
// LLM provider. The markdown response and non-sensitive audit metadata are
// stored in CoachSession; the structured payload is not persisted.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId(req);

    const payload = await buildCoachPayload(userId);
    const { markdown, modelUsed, auditPrompt } = await callCoach(payload);

    const now = new Date();
    const weekStart = isoWeekStart(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const stored = await db.coachSession.create({
      data: {
        userId,
        weekStart,
        weekEnd,
        prompt: auditPrompt,
        response: markdown,
      },
    });

    return NextResponse.json({
      id: stored.id,
      response: markdown,
      modelUsed,
      createdAt: stored.createdAt,
    });
  } catch (err) {
    if (err instanceof LlmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleApiError(err);
  }
}

// GET /api/coach: debrief history (the last 20).
export async function GET(req: Request) {
  try {
    const userId = await requireApiUserId(req);
    const items = await db.coachSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        weekStart: true,
        weekEnd: true,
        response: true,
        appliedAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json(items);
  } catch (err) {
    return handleApiError(err);
  }
}
