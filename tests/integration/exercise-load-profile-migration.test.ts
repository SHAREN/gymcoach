import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const migrationPath = path.join(
  process.cwd(),
  'prisma/migrations/20260718120000_add_exercise_load_profiles/migration.sql',
);

describe('exercise load-profile migration', () => {
  it('reviews only proven catalog fingerprints and preserves legacy name collisions', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error('DATABASE_URL is required for migration integration tests.');

    const client = new Client({ connectionString });
    const schema = `load_profile_migration_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`
        CREATE TABLE "Exercise" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "muscleGroup" TEXT NOT NULL,
          "category" TEXT NOT NULL,
          "defaultRestSec" INTEGER NOT NULL,
          "notes" TEXT,
          "usesBodyweight" BOOLEAN NOT NULL DEFAULT false,
          "equipmentType" TEXT NOT NULL DEFAULT 'OTHER'
        )
      `);
      await client.query(
        `
          INSERT INTO "Exercise" (
            "id", "userId", "name", "muscleGroup", "category",
            "defaultRestSec", "notes", "usesBodyweight", "equipmentType"
          ) VALUES
            ($1, $2, $3, $4, $5, $6, $7, false, 'OTHER'),
            ($8, $9, $10, $11, $12, $13, $14, false, 'OTHER'),
            ($15, $16, $17, $18, $19, $20, $21, false, 'OTHER')
        `,
        [
          'canonical-bench',
          'system-user',
          'Barbell bench press',
          'CHEST',
          'COMPOUND',
          150,
          'Bar in the heel of the palm, wrist aligned with the forearm. Elbows at 45 degrees from the torso. Touch the chest.',
          'custom-bench',
          'custom-user',
          'Barbell bench press',
          'CHEST',
          'COMPOUND',
          90,
          'User-created bench variation.',
          'custom-deadlift',
          'custom-user',
          'Deadlift',
          'BACK_THICKNESS',
          'COMPOUND',
          180,
          'User-created deadlift entry.',
        ],
      );

      await client.query(await readFile(migrationPath, 'utf8'));
      const result = await client.query<{
        id: string;
        catalogOrigin: string | null;
        loadProfile: {
          classification: string;
          secondaryMuscles: { state: string; entries: unknown[] };
          fatigueTags: { state: string; entries: unknown[] };
          jointStress: { state: string; entries: unknown[] };
        };
      }>(`SELECT "id", "catalogOrigin", "loadProfile" FROM "Exercise" ORDER BY "id"`);
      const rows = new Map(result.rows.map((row) => [row.id, row]));

      expect(rows.get('canonical-bench')).toMatchObject({
        catalogOrigin: 'SYSTEM_DEFAULT_V1',
        loadProfile: {
          classification: 'REVIEWED',
          secondaryMuscles: {
            state: 'KNOWN',
            entries: expect.arrayContaining([expect.objectContaining({ muscleGroup: 'TRICEPS' })]),
          },
        },
      });
      for (const id of ['custom-bench', 'custom-deadlift']) {
        expect(rows.get(id)).toMatchObject({
          catalogOrigin: null,
          loadProfile: {
            classification: 'LEGACY_PRIMARY_ONLY',
            secondaryMuscles: { state: 'UNKNOWN', entries: [] },
            fatigueTags: { state: 'UNKNOWN', entries: [] },
            jointStress: { state: 'UNKNOWN', entries: [] },
          },
        });
      }
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});
