export interface SessionProgramExerciseRef {
  id: string;
}

export function initialSessionExerciseIndex(
  exercises: readonly SessionProgramExerciseRef[],
  requestedProgramExerciseId: string | null | undefined,
): number {
  if (!requestedProgramExerciseId) return 0;
  const requested = exercises.findIndex((item) => item.id === requestedProgramExerciseId);
  return requested >= 0 ? requested : 0;
}

export function safeSessionReturnTo(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !value.startsWith('/session/') || value.startsWith('//')) {
    return '/exercises';
  }

  try {
    const parsed = new URL(value, 'http://gymcoach.local');
    if (
      parsed.origin !== 'http://gymcoach.local' ||
      !/^\/session\/[^/]+$/u.test(parsed.pathname)
    ) {
      return '/exercises';
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/exercises';
  }
}
