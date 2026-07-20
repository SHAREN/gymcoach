import { describe, expect, it } from 'vitest';
import { programDesignRequestSchema, programHealthStatusSchema } from './program-design';

describe('program-design intake compatibility', () => {
  it('normalizes legacy health values to the structured coaching-profile contract', () => {
    expect(programHealthStatusSchema.parse('NO_RELEVANT_CONCERNS')).toBe('NO_SIGNIFICANT_ISSUES');
    expect(programHealthStatusSchema.parse('CLEARED_WITH_LIMITATIONS')).toBe(
      'TRAIN_WITH_LIMITATIONS',
    );
    expect(programHealthStatusSchema.parse('NEEDS_MEDICAL_CLEARANCE')).toBe(
      'MEDICAL_CLEARANCE_REQUIRED',
    );
  });

  it('allows a context request without a goal so the deterministic gate can ask for it', () => {
    expect(programDesignRequestSchema.parse({}).goal).toBe('');
  });
});
