// ProgramExercise.notes may contain both a real user/coach cue and metadata
// produced by an importer. The session runner should only surface the former.

const IMPORT_METADATA_PATTERNS = [
  /^alpha\s+(?:prescription|metadata)\s*:/iu,
  /^\[?alpha[-\s]?progression[^\]]*\]?/iu,
  /^imported\s+from\s+alpha\s+progression\b/iu,
  /^original\s+exercise\s*:/iu,
  /^импортировано\s+из\s+alpha\s+progression\b/iu,
  /^исходное\s+упражнение\s*:/iu,
];

const PRESCRIPTION_WORDS =
  /(?:sets?|reps?|rir|rpe|rest|tempo|подход(?:а|ов|ы)?|повтор(?:а|ов|ы)?|отдых|темп|суперсет(?:а|ов|ы)?)/giu;

function isPrescriptionOnly(line: string): boolean {
  const terms = line.match(PRESCRIPTION_WORDS) ?? [];
  if (terms.length < 2) return false;

  const residue = line
    .replace(PRESCRIPTION_WORDS, '')
    .replace(/[\d\s.,;:x×/@%()+\-[\]–—]+/gu, '')
    .trim();
  return residue.length === 0;
}

function isBoilerplateLine(line: string): boolean {
  return IMPORT_METADATA_PATTERNS.some((pattern) => pattern.test(line)) || isPrescriptionOnly(line);
}

/**
 * Returns only note lines that carry a genuine user/coach cue.
 *
 * Import metadata is removed line by line so a useful cue survives even when
 * it shares the same database field with an Alpha Progression prescription.
 */
export function meaningfulProgramNote(note: string | null | undefined): string | null {
  if (!note?.trim()) return null;

  const meaningfulLines = note
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isBoilerplateLine(line));

  if (meaningfulLines.length === 0) return null;
  return meaningfulLines.join('\n');
}

export function hasMeaningfulProgramNote(note: string | null | undefined): boolean {
  return meaningfulProgramNote(note) != null;
}
