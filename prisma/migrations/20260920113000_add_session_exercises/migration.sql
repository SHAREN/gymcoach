-- SessionExercise may already exist on installations that previously ran the
-- durable session-membership feature. Preserve those rows and extend the table
-- with free-workout target metadata instead of replacing it.
CREATE TABLE IF NOT EXISTS "SessionExercise" (
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordinal" INTEGER,
    "targetSets" INTEGER,
    "targetRepsMin" INTEGER,
    "targetRepsMax" INTEGER,
    "targetRIR" INTEGER,
    "restSec" INTEGER,
    "tempo" TEXT,
    "notes" TEXT,
    "supersetGroup" INTEGER,
    "autoregulationMode" "SetAutoregulationMode",
    "fatigueRate" DOUBLE PRECISION,
    "loadAdjustmentPct" DOUBLE PRECISION,
    CONSTRAINT "SessionExercise_pkey" PRIMARY KEY ("sessionId", "exerciseId")
);

ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "ordinal" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "targetSets" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "targetRepsMin" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "targetRepsMax" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "targetRIR" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "restSec" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "tempo" TEXT;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "supersetGroup" INTEGER;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "autoregulationMode" "SetAutoregulationMode";
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "fatigueRate" DOUBLE PRECISION;
ALTER TABLE "SessionExercise" ADD COLUMN IF NOT EXISTS "loadAdjustmentPct" DOUBLE PRECISION;

WITH missing AS (
  SELECT s."sessionId", s."exerciseId", MIN(s."completedAt") AS "addedAt"
  FROM "Set" s
  WHERE NOT EXISTS (
    SELECT 1 FROM "SessionExercise" se
    WHERE se."sessionId" = s."sessionId" AND se."exerciseId" = s."exerciseId"
  )
  GROUP BY s."sessionId", s."exerciseId"
), ranked AS (
  SELECT m.*, ROW_NUMBER() OVER (
    PARTITION BY m."sessionId" ORDER BY m."addedAt", m."exerciseId"
  ) - 1 AS rn
  FROM missing m
), existing_max AS (
  SELECT "sessionId", COALESCE(MAX("ordinal"), -1) AS max_ordinal
  FROM "SessionExercise"
  GROUP BY "sessionId"
)
INSERT INTO "SessionExercise" ("sessionId", "exerciseId", "addedAt", "ordinal")
SELECT r."sessionId", r."exerciseId", r."addedAt", COALESCE(e.max_ordinal, -1) + 1 + r.rn
FROM ranked r
LEFT JOIN existing_max e ON e."sessionId" = r."sessionId"
ON CONFLICT ("sessionId", "exerciseId") DO NOTHING;

WITH ranked AS (
  SELECT "sessionId", "exerciseId", ROW_NUMBER() OVER (
    PARTITION BY "sessionId" ORDER BY "addedAt", "exerciseId"
  ) - 1 AS ordinal
  FROM "SessionExercise"
)
UPDATE "SessionExercise" se
SET "ordinal" = ranked.ordinal
FROM ranked
WHERE se."sessionId" = ranked."sessionId"
  AND se."exerciseId" = ranked."exerciseId"
  AND se."ordinal" IS NULL;

ALTER TABLE "SessionExercise" ALTER COLUMN "ordinal" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "SessionExercise_exerciseId_idx" ON "SessionExercise"("exerciseId");
CREATE UNIQUE INDEX IF NOT EXISTS "SessionExercise_sessionId_ordinal_key" ON "SessionExercise"("sessionId", "ordinal");

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SessionExercise_sessionId_fkey') THEN
    ALTER TABLE "SessionExercise"
    ADD CONSTRAINT "SessionExercise_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SessionExercise_exerciseId_fkey') THEN
    ALTER TABLE "SessionExercise"
    ADD CONSTRAINT "SessionExercise_exerciseId_fkey"
    FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $migration$;

CREATE OR REPLACE FUNCTION preserve_session_exercise_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  max_ordinal INTEGER;
  next_ordinal INTEGER;
  membership RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."sessionId", 0));
  IF EXISTS (
    SELECT 1 FROM "SessionExercise"
    WHERE "sessionId" = NEW."sessionId" AND "exerciseId" = NEW."exerciseId"
  ) THEN
    RETURN NEW;
  END IF;
  SELECT MAX("ordinal") INTO max_ordinal
  FROM "SessionExercise" WHERE "sessionId" = NEW."sessionId";
  IF max_ordinal = 2147483647 THEN
    next_ordinal := 0;
    FOR membership IN
      SELECT "exerciseId" FROM "SessionExercise"
      WHERE "sessionId" = NEW."sessionId" ORDER BY "ordinal" ASC
    LOOP
      UPDATE "SessionExercise" SET "ordinal" = next_ordinal
      WHERE "sessionId" = NEW."sessionId" AND "exerciseId" = membership."exerciseId";
      next_ordinal := next_ordinal + 1;
    END LOOP;
  ELSE
    next_ordinal := COALESCE(max_ordinal, -1) + 1;
  END IF;
  INSERT INTO "SessionExercise" ("sessionId", "exerciseId", "addedAt", "ordinal")
  VALUES (NEW."sessionId", NEW."exerciseId", NEW."completedAt", next_ordinal)
  ON CONFLICT ("sessionId", "exerciseId") DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS preserve_session_exercise_membership_after_set_insert ON "Set";
CREATE TRIGGER preserve_session_exercise_membership_after_set_insert
AFTER INSERT ON "Set"
FOR EACH ROW
EXECUTE FUNCTION preserve_session_exercise_membership();
