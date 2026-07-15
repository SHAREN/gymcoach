import { beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must point to a test database for integration tests. ' +
      'Run `bash scripts/verify.sh --full`, or start it with the explicit ' +
      '`docker compose --project-name gymcoach-test -f docker-compose.test.yml up -d --wait test-db` scope.',
  );
}

// Truncates every table between tests so each starts from a clean slate.
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "Message","Conversation","ReadinessCheckin","ExerciseGoal","BodyweightEntry","Set","Session","ProgramExercise","Workout","Program","Exercise","CoachSession","User" RESTART IDENTITY CASCADE;',
  );
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});
