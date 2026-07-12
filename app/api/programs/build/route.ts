import { NextResponse } from 'next/server';
import { ApiError, handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { buildProgramFromGenerated, evaluateProgramDesign } from '@/lib/program-generation';
import { PROGRAM_DESIGN_METHODOLOGY_VERSION } from '@/lib/program-design-methodology';
import { generatedProgramBuildInputSchema } from '@/lib/schemas/program-design';

export async function POST(req: Request) {
  try {
    const userId = await requireApiUserId();
    const input = await parseJsonBody(req, generatedProgramBuildInputSchema);
    const { context, validation } = await evaluateProgramDesign(
      userId,
      {
        goal: input.goal,
        mode: input.mode,
        sourceProgramId: input.sourceProgramId ?? undefined,
        answers: input.answers,
      },
      input.program,
    );
    if (context.missingQuestions.length > 0) {
      throw new ApiError(400, 'Answer every required program-design question before saving.');
    }
    const errors = validation.issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      throw new ApiError(400, errors.map((issue) => issue.message).join(' '));
    }
    const id = await buildProgramFromGenerated(userId, input.program, {
      sourceProgramId: context.sourceProgramId,
      methodologyVersion: PROGRAM_DESIGN_METHODOLOGY_VERSION,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
