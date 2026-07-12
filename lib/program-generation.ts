import { db } from '@/lib/db';
import { getLlmProvider, LlmError } from '@/lib/llm';
import { PROGRAM_GEN_SYSTEM_PROMPT } from '@/lib/prompts/program-system-prompt';
import { parseGeneratedProgram, type GeneratedProgram } from '@/lib/schemas/program-generation';
import { defaultIntraSetConfig } from '@/lib/intra-set-autoregulation';
import { buildProgramDesignContext } from '@/lib/program-design-context';
import {
  validateProgramDesign,
  type ProgramDesignValidation,
} from '@/lib/program-design-validation';
import type { ProgramDesignRequest } from '@/lib/schemas/program-design';

export type ProgramGenerationResult =
  | {
      status: 'needs-input';
      questions: Awaited<ReturnType<typeof buildProgramDesignContext>>['missingQuestions'];
      methodologyVersion: string;
      sourceProgramId: string | null;
    }
  | {
      status: 'generated';
      program: GeneratedProgram;
      validation: ProgramDesignValidation;
      methodologyVersion: string;
      sourceProgramId: string | null;
    };

export async function evaluateProgramDesign(
  userId: string,
  request: ProgramDesignRequest,
  program: GeneratedProgram,
) {
  const context = await buildProgramDesignContext({
    userId,
    goal: request.goal,
    mode: request.mode,
    sourceProgramId: request.sourceProgramId,
    answers: request.answers,
  });
  return {
    context,
    validation: validateProgramDesign(program, context),
  };
}

// Generates a structured program draft from a natural-language goal. Does not
// persist anything: the result is previewed (and edited) before saving.
export async function generateProgram(
  userId: string,
  request: ProgramDesignRequest,
): Promise<ProgramGenerationResult> {
  const provider = getLlmProvider();
  const context = await buildProgramDesignContext({
    userId,
    goal: request.goal,
    mode: request.mode,
    sourceProgramId: request.sourceProgramId,
    answers: request.answers,
  });
  if (context.missingQuestions.length > 0) {
    return {
      status: 'needs-input',
      questions: context.missingQuestions,
      methodologyVersion: context.methodologyVersion,
      sourceProgramId: context.sourceProgramId,
    };
  }

  const userMessage = `ProgramDesignContext (JSON):\n${JSON.stringify(context, null, 2)}`;

  const { text } = await provider.complete({
    system: PROGRAM_GEN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens: 8000,
  });

  const parsed = parseGeneratedProgram(text);
  if (!parsed.ok) {
    throw new LlmError(502, `The generated program could not be parsed: ${parsed.error}`);
  }
  return {
    status: 'generated',
    program: parsed.program,
    validation: validateProgramDesign(parsed.program, context),
    methodologyVersion: context.methodologyVersion,
    sourceProgramId: context.sourceProgramId,
  };
}

// Persists a (possibly user-edited) generated program in a single transaction.
// New exercises are created on the fly; existing ones are reused by name.
// Returns the new program id. The program is created inactive.
export async function buildProgramFromGenerated(
  userId: string,
  program: GeneratedProgram,
  options: { sourceProgramId?: string | null; methodologyVersion?: string | null } = {},
): Promise<string> {
  if (options.sourceProgramId) {
    const source = await db.program.findFirst({
      where: { id: options.sourceProgramId, userId },
      select: { id: true },
    });
    if (!source) throw new Error('Source program not found.');
  }
  return db.$transaction(async (tx) => {
    const created = await tx.program.create({
      data: {
        userId,
        name: program.name,
        description: program.description ?? null,
        phase: program.phase,
        isActive: false,
        parentProgramId: options.sourceProgramId ?? null,
        methodologyVersion: options.methodologyVersion ?? null,
      },
    });

    let workoutOrder = 1;
    for (const w of program.workouts) {
      const workout = await tx.workout.create({
        data: {
          programId: created.id,
          name: w.name,
          dayOfWeek: w.dayOfWeek ?? null,
          order: workoutOrder++,
        },
      });

      let exerciseOrder = 1;
      for (const ex of w.exercises) {
        const existingExercise = await tx.exercise.findFirst({
          where: { userId, name: { equals: ex.name, mode: 'insensitive' } },
        });
        const exercise =
          existingExercise ??
          (await tx.exercise.create({
            data: {
              userId,
              name: ex.name,
              muscleGroup: ex.muscleGroup,
              category: ex.category,
              equipmentType: ex.equipmentType ?? 'OTHER',
              defaultRestSec: ex.restSec,
            },
          }));

        await tx.programExercise.create({
          data: {
            workoutId: workout.id,
            exerciseId: exercise.id,
            order: exerciseOrder++,
            targetSets: ex.targetSets,
            targetDropSets: ex.targetDropSets ?? 0,
            targetRepsMin: ex.targetRepsMin,
            targetRepsMax: Math.max(ex.targetRepsMax, ex.targetRepsMin),
            targetRIR: ex.targetRIR,
            restSec: ex.restSec,
            autoregulationMode: ex.autoregulationMode ?? 'PRESERVE_RIR',
            fatigueRate: ex.fatigueRate ?? defaultIntraSetConfig(exercise).fatigueRate,
            loadAdjustmentPct:
              ex.loadAdjustmentPct ?? defaultIntraSetConfig(exercise).loadAdjustmentPct,
            tempo: ex.tempo ?? null,
            notes: ex.notes ?? null,
            supersetGroup: ex.supersetGroup ?? null,
          },
        });
      }
    }

    return created.id;
  });
}
