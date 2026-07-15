CREATE TABLE "SessionExercise" (
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionExercise_pkey" PRIMARY KEY ("sessionId", "exerciseId")
);

CREATE INDEX "SessionExercise_exerciseId_idx" ON "SessionExercise"("exerciseId");

ALTER TABLE "SessionExercise"
ADD CONSTRAINT "SessionExercise_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionExercise"
ADD CONSTRAINT "SessionExercise_exerciseId_fkey"
FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "SessionExercise" ("sessionId", "exerciseId", "addedAt")
SELECT "sessionId", "exerciseId", MIN("completedAt")
FROM "Set"
GROUP BY "sessionId", "exerciseId";

CREATE FUNCTION preserve_session_exercise_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "SessionExercise" ("sessionId", "exerciseId", "addedAt")
  VALUES (NEW."sessionId", NEW."exerciseId", NEW."completedAt")
  ON CONFLICT ("sessionId", "exerciseId") DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER preserve_session_exercise_membership_after_set_insert
AFTER INSERT ON "Set"
FOR EACH ROW
EXECUTE FUNCTION preserve_session_exercise_membership();
