export interface EntityMatchCandidate {
  id: string;
  canonicalName: string;
  displayName?: string;
  aliases: string[];
  contextBonus?: number;
  reasons?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResolvedCandidate {
  id: string;
  canonicalName: string;
  displayName?: string;
  confidence: number;
  reasons: string[];
  metadata?: Record<string, unknown>;
}

export interface EntityResolution {
  query: string;
  status: 'RESOLVED' | 'AMBIGUOUS' | 'NOT_FOUND';
  selected: ResolvedCandidate | null;
  candidates: ResolvedCandidate[];
}

export function resolveEntityName(
  query: string,
  rows: EntityMatchCandidate[],
  maxCandidates = 5,
): EntityResolution {
  const cleanQuery = normalizeEntityName(query);
  if (!cleanQuery) return { query, status: 'NOT_FOUND', selected: null, candidates: [] };

  const candidates = rows
    .map((row) => {
      let bestLexical = 0;
      let matchedAlias = row.canonicalName;
      for (const alias of row.aliases) {
        const score = lexicalScore(cleanQuery, normalizeEntityName(alias));
        if (score > bestLexical) {
          bestLexical = score;
          matchedAlias = alias;
        }
      }
      const confidence = round(Math.min(1, bestLexical + (row.contextBonus ?? 0)));
      const reasons = [
        ...(bestLexical === 1 ? ['exact-name-or-translation'] : []),
        ...(bestLexical >= 0.9 && bestLexical < 1 ? ['strong-name-match'] : []),
        ...(bestLexical >= 0.65 && bestLexical < 0.9 ? ['fuzzy-name-match'] : []),
        ...(row.reasons ?? []),
      ];
      return {
        id: row.id,
        canonicalName: row.canonicalName,
        ...(row.displayName ? { displayName: row.displayName } : {}),
        confidence,
        reasons: [...new Set(reasons)],
        metadata: { ...(row.metadata ?? {}), matchedAlias },
      } satisfies ResolvedCandidate;
    })
    .filter((row) => row.confidence >= 0.25)
    .sort((a, b) => b.confidence - a.confidence || a.canonicalName.localeCompare(b.canonicalName))
    .slice(0, Math.max(1, Math.min(maxCandidates, 10)));

  const top = candidates[0] ?? null;
  if (!top || top.confidence < 0.6) {
    return { query, status: 'NOT_FOUND', selected: null, candidates };
  }
  const second = candidates[1] ?? null;
  if (
    second &&
    top.confidence < 0.98 &&
    second.confidence >= 0.6 &&
    top.confidence - second.confidence < 0.08
  ) {
    return { query, status: 'AMBIGUOUS', selected: null, candidates };
  }
  return { query, status: 'RESOLVED', selected: top, candidates };
}

export function normalizeEntityName(value: string) {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\p{M}/gu, '')
    .replace(/подъе?м(?:ы|а|ов)?/gu, 'сгибание')
    .replace(/бицепс(?:а|у|ом)?/gu, 'рук')
    .replace(/тренаж[её]р(?:е|а|ы|ов)?/gu, 'машина')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function lexicalScore(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.startsWith(a) || a.startsWith(b)) return 0.94;
  if (b.includes(a) || a.includes(b)) return 0.9;

  const aSet = new Set(a.split(' ').filter(Boolean));
  const bSet = new Set(b.split(' ').filter(Boolean));
  const intersection = [...aSet].filter((part) => bSet.has(part)).length;
  const tokenDice = aSet.size + bSet.size > 0 ? (2 * intersection) / (aSet.size + bSet.size) : 0;
  const editSimilarity = 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
  return Math.max(tokenDice * 0.9, editSimilarity * 0.86);
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
