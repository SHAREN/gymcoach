import { describe, expect, it } from 'vitest';
import { normalizeEntityName, resolveEntityName } from '@/lib/mcp/entity-match';

describe('MCP entity matching', () => {
  it('normalizes common Russian historical-workout phrasing', () => {
    expect(normalizeEntityName('Подъём на бицепс обратным хватом')).toBe(
      'сгибание на рук обратным хватом',
    );
  });

  it('resolves an exact Russian display name to the canonical exercise', () => {
    const result = resolveEntityName('Жим лёжа', [
      {
        id: 'bench',
        canonicalName: 'Bench Press',
        displayName: 'Жим лёжа',
        aliases: ['Bench Press', 'Жим лёжа'],
      },
      {
        id: 'incline',
        canonicalName: 'Incline Bench Press',
        displayName: 'Жим штанги на наклонной скамье',
        aliases: ['Incline Bench Press', 'Жим штанги на наклонной скамье'],
      },
    ]);

    expect(result.status).toBe('RESOLVED');
    expect(result.selected).toMatchObject({ id: 'bench', confidence: 1 });
  });

  it('returns candidates instead of silently choosing a close ambiguous match', () => {
    const result = resolveEntityName('верхняя тяга', [
      {
        id: 'wide',
        canonicalName: 'Lat pulldown wide',
        aliases: ['верхняя тяга широким хватом'],
      },
      {
        id: 'neutral',
        canonicalName: 'Lat pulldown neutral',
        aliases: ['верхняя тяга нейтральным хватом'],
      },
    ]);

    expect(['AMBIGUOUS', 'NOT_FOUND']).toContain(result.status);
    expect(result.candidates.length).toBeGreaterThan(0);
  });
});
