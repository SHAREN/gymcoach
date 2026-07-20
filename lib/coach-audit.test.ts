import { describe, expect, it } from 'vitest';
import { createCoachAuditPrompt, sanitizeCoachAuditPrompt } from './coach-audit';

describe('coach audit prompt metadata', () => {
  it('serializes only the canonical non-sensitive generation metadata', () => {
    expect(JSON.parse(createCoachAuditPrompt())).toEqual({
      version: 1,
      kind: 'weekly-debrief',
      source: 'generated',
    });
  });

  it('redacts legacy text, full payloads, and metadata with extra fields', () => {
    const redacted = createCoachAuditPrompt('legacy-redacted');

    expect(sanitizeCoachAuditPrompt('legacy prompt text')).toBe(redacted);
    expect(
      sanitizeCoachAuditPrompt(
        JSON.stringify({
          generatedAt: '2026-07-20T00:00:00.000Z',
          userProfile: { coachingProfile: { privateField: 'must-not-survive' } },
        }),
      ),
    ).toBe(redacted);
    expect(
      sanitizeCoachAuditPrompt(
        JSON.stringify({
          version: 1,
          kind: 'weekly-debrief',
          source: 'generated',
          privateField: 'must-not-survive',
        }),
      ),
    ).toBe(redacted);
  });

  it('preserves only valid canonical metadata', () => {
    expect(sanitizeCoachAuditPrompt(createCoachAuditPrompt('generated'))).toBe(
      createCoachAuditPrompt('generated'),
    );
  });
});
