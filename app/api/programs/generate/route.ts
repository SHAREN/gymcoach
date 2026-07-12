import { NextResponse } from 'next/server';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { LlmError } from '@/lib/llm';
import { rateLimit } from '@/lib/rate-limit';
import { generateProgram } from '@/lib/program-generation';
import { programDesignRequestSchema } from '@/lib/schemas/program-design';

// POST /api/programs/generate: returns a structured program draft for the
// user to preview and edit. Does not persist anything.
export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const rl = rateLimit(`generate:${userId}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many generations. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }
    const input = await parseJsonBody(req, programDesignRequestSchema);
    const result = await generateProgram(userId, input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LlmError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return handleApiError(err);
  }
}
