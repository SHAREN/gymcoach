import { z } from 'zod';

const coachAuditPromptSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('weekly-debrief'),
    source: z.enum(['generated', 'legacy-redacted']),
  })
  .strict();

export type CoachAuditSource = z.infer<typeof coachAuditPromptSchema>['source'];

export function createCoachAuditPrompt(source: CoachAuditSource = 'generated'): string {
  return JSON.stringify({ version: 1, kind: 'weekly-debrief', source });
}

export function sanitizeCoachAuditPrompt(prompt: string): string {
  try {
    const parsed = coachAuditPromptSchema.safeParse(JSON.parse(prompt));
    if (parsed.success) return JSON.stringify(parsed.data);
  } catch {
    // Legacy prompts may be plain text or full serialized coach payloads.
  }
  return createCoachAuditPrompt('legacy-redacted');
}
