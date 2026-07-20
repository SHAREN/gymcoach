import { z } from 'zod';

const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

const strengthSetDraftSchema = z.object({
  weight: z.number().finite().nonnegative(),
  reps: z.number().int().nonnegative(),
  rir: z.number().int().min(0).max(5).nullable(),
});

const cardioSetDraftSchema = z.object({
  weight: z.number().finite().nonnegative(),
  reps: z.number().int().nonnegative(),
  rir: z.number().int().min(0).max(5).nullable(),
  durationInput: z.string().max(32),
  distanceInput: z.string().max(32),
  isWarmup: z.boolean(),
  isDropSet: z.boolean(),
  notes: z.string().max(2000),
});

const returnModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('input') }),
  z.object({
    kind: z.literal('rest'),
    endsAt: z.number().finite().positive(),
    totalSec: z.number().int().positive().max(3600),
    nextExerciseIdx: z.number().int().nonnegative().nullable(),
    navigatedImmediately: z.boolean(),
  }),
]);

const sessionDetailReturnStateSchema = z.object({
  version: z.literal(1),
  sessionId: z.string().min(1),
  savedAt: z.number().finite().positive(),
  selectedEquipmentByExercise: z.record(z.string(), z.string().nullable()),
  targetSetOverrides: z.record(z.string(), z.number().int().min(1).max(20)),
  strengthDraftsByExercise: z.record(z.string(), strengthSetDraftSchema),
  cardioDraftsByExercise: z.record(z.string(), cardioSetDraftSchema),
  mode: returnModeSchema,
});

export type StrengthSetDraft = z.infer<typeof strengthSetDraftSchema>;
export type CardioSetDraft = z.infer<typeof cardioSetDraftSchema>;
export type SessionDetailReturnState = z.infer<typeof sessionDetailReturnStateSchema>;

function storageKey(sessionId: string) {
  return `gymcoach:session-detail-return:v1:${sessionId}`;
}

export function saveSessionDetailReturnState(state: SessionDetailReturnState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(state.sessionId), JSON.stringify(state));
  } catch {
    // The detail route still works when storage is unavailable. Only volatile
    // workout UI state loses its optional restoration path.
  }
}

export function consumeSessionDetailReturnState(
  sessionId: string,
  now = Date.now(),
): SessionDetailReturnState | null {
  if (typeof window === 'undefined') return null;
  const key = storageKey(sessionId);
  try {
    const raw = window.sessionStorage.getItem(key);
    window.sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = sessionDetailReturnStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.sessionId !== sessionId) return null;
    if (now - parsed.data.savedAt > SNAPSHOT_MAX_AGE_MS || parsed.data.savedAt > now + 60_000) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
