import { describe, expect, it } from 'vitest';
import { meaningfulProgramNote } from './program-notes';

describe('meaningfulProgramNote', () => {
  it('hides Alpha Progression prescription and metadata lines', () => {
    expect(
      meaningfulProgramNote('Alpha prescription: 5 sets; 10 reps\nAlpha metadata: Superset 1'),
    ).toBeNull();
  });

  it('hides older one-line import metadata', () => {
    expect(
      meaningfulProgramNote(
        '[alpha-progression-2026-07-10] Imported from Alpha Progression. Original exercise: Incline Bench Press.',
      ),
    ).toBeNull();
  });

  it('hides a bare prescription already visible in the set table', () => {
    expect(meaningfulProgramNote('4 sets x 8 reps; RIR 2; rest 90')).toBeNull();
    expect(meaningfulProgramNote('4 подхода × 10 повторов, RIR 2')).toBeNull();
  });

  it('keeps a user or coach cue and removes metadata around it', () => {
    expect(
      meaningfulProgramNote(
        'Alpha prescription: 4 sets; 10 reps\nKeep elbows tucked and stop if the wrist hurts.\nAlpha metadata: Superset 2',
      ),
    ).toBe('Keep elbows tucked and stop if the wrist hurts.');
  });

  it('does not hide a genuine note that happens to mention RIR', () => {
    expect(meaningfulProgramNote('Today keep 3 RIR because the shoulder is irritated.')).toBe(
      'Today keep 3 RIR because the shoulder is irritated.',
    );
  });
});
