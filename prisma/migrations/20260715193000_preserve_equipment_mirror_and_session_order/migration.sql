ALTER TABLE "GymExerciseConfig"
ADD COLUMN "isEquipmentMirror" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GymEquipmentExercise"
ADD COLUMN "mirrorsLegacyConfig" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "SessionExercise"
ADD COLUMN "ordinal" INTEGER;

WITH ranked AS (
  SELECT
    "sessionId",
    "exerciseId",
    ROW_NUMBER() OVER (
      PARTITION BY "sessionId"
      ORDER BY "addedAt" ASC, "exerciseId" ASC
    ) - 1 AS ordinal
  FROM "SessionExercise"
)
UPDATE "SessionExercise" AS membership
SET "ordinal" = ranked.ordinal
FROM ranked
WHERE membership."sessionId" = ranked."sessionId"
  AND membership."exerciseId" = ranked."exerciseId";

ALTER TABLE "SessionExercise"
ALTER COLUMN "ordinal" SET NOT NULL;

CREATE UNIQUE INDEX "SessionExercise_sessionId_ordinal_key"
ON "SessionExercise"("sessionId", "ordinal");

CREATE OR REPLACE FUNCTION preserve_session_exercise_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialize new exercise memberships inside one session without locking
  -- the Session row itself, which may be updated concurrently at finish.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."sessionId", 0));

  INSERT INTO "SessionExercise" ("sessionId", "exerciseId", "addedAt", "ordinal")
  SELECT
    NEW."sessionId",
    NEW."exerciseId",
    NEW."completedAt",
    COALESCE(MAX("ordinal"), -1) + 1
  FROM "SessionExercise"
  WHERE "sessionId" = NEW."sessionId"
  ON CONFLICT ("sessionId", "exerciseId") DO NOTHING;
  RETURN NEW;
END;
$$;
