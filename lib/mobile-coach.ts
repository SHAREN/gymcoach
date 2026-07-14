import { db } from '@/lib/db';
import { buildCoachPayload } from '@/lib/coach';
import { summarizeCoachPayload } from '@/lib/coach-context';
import { getLlmProvider } from '@/lib/llm';

export interface MobileCoachOverview {
  context: ReturnType<typeof summarizeCoachPayload>;
  coachNote: string | null;
  provider: {
    configured: boolean;
    label: string;
    apiKeyEnvVar: string;
  };
  history: Array<{
    id: string;
    weekStart: string;
    weekEnd: string;
    response: string;
    appliedAt: string | null;
    createdAt: string;
  }>;
  programDefaults: Record<
    string,
    {
      targetRepsMin: number;
      targetRepsMax: number;
      targetSets: number;
      targetRIR: number;
      restSec: number;
    }
  >;
  conversations: Array<{
    id: string;
    title: string | null;
    updatedAt: string;
  }>;
}

// Native Android reads the same server-built context, history and program
// defaults as the web coach page. No training signal or adjustment is derived
// on the phone.
export async function buildMobileCoachOverview(userId: string): Promise<MobileCoachOverview> {
  const [payload, history, activeProgram, conversations] = await Promise.all([
    buildCoachPayload(userId),
    db.coachSession.findMany({
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
    }),
    db.program.findFirst({
      where: { userId, isActive: true },
      include: {
        workouts: {
          include: {
            exercises: {
              include: { exercise: { select: { name: true } } },
            },
          },
        },
      },
    }),
    db.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, updatedAt: true },
    }),
  ]);

  const programDefaults: MobileCoachOverview['programDefaults'] = {};
  for (const workout of activeProgram?.workouts ?? []) {
    for (const programExercise of workout.exercises) {
      const key = programExercise.exercise.name;
      if (programDefaults[key]) continue;
      programDefaults[key] = {
        targetRepsMin: programExercise.targetRepsMin,
        targetRepsMax: programExercise.targetRepsMax,
        targetSets: programExercise.targetSets,
        targetRIR: programExercise.targetRIR,
        restSec: programExercise.restSec,
      };
    }
  }

  const provider = getLlmProvider();
  return {
    context: summarizeCoachPayload(payload),
    coachNote: payload.userProfile.coachNote,
    provider: {
      configured: provider.isConfigured(),
      label: provider.label,
      apiKeyEnvVar: provider.apiKeyEnvVar,
    },
    history: history.map((item) => ({
      id: item.id,
      weekStart: item.weekStart.toISOString(),
      weekEnd: item.weekEnd.toISOString(),
      response: item.response,
      appliedAt: item.appliedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
    programDefaults,
    conversations: conversations.map((item) => ({
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt.toISOString(),
    })),
  };
}
