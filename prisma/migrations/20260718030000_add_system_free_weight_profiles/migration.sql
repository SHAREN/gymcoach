DO $$
BEGIN
  CREATE TYPE "BarbellDiameterFamily" AS ENUM ('LARGE', 'SMALL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "GymExerciseConfig"
ADD COLUMN IF NOT EXISTS "systemProfileSupported" BOOLEAN;

ALTER TABLE "GymEquipment"
ADD COLUMN IF NOT EXISTS "systemBarbellFamily" "BarbellDiameterFamily";

ALTER TABLE "GymPlatePool"
ADD COLUMN IF NOT EXISTS "systemBarbellFamily" "BarbellDiameterFamily";

-- Preserve the owner-configured Olymp compatibility facts by marking the
-- existing small-diameter pool and the migrated legacy large-diameter pool in
-- place. No pool, plate, bar, link, preference, or historical set is replaced.
WITH candidates AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "gymId"
      ORDER BY CASE "compatibilityKey" WHEN 'small_diameter' THEN 0 ELSE 1 END, "createdAt", "id"
    ) AS position
  FROM "GymPlatePool"
  WHERE "compatibilityKey" IN ('small_diameter', 'system_barbell_small')
)
UPDATE "GymPlatePool" pool
SET "systemBarbellFamily" = 'SMALL'
FROM candidates
WHERE pool."id" = candidates."id"
  AND candidates.position = 1;

WITH candidates AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "gymId"
      ORDER BY CASE "compatibilityKey" WHEN 'legacy-default' THEN 0 ELSE 1 END, "createdAt", "id"
    ) AS position
  FROM "GymPlatePool"
  WHERE "compatibilityKey" IN ('legacy-default', 'system_barbell_large')
)
UPDATE "GymPlatePool" pool
SET "systemBarbellFamily" = 'LARGE'
FROM candidates
WHERE pool."id" = candidates."id"
  AND candidates.position = 1;

-- If an older equipment-first gym used another named pool for its concrete
-- bars, preserve that pool as the large family instead of copying its data.
WITH candidates AS (
  SELECT
    pool."id",
    pool."gymId",
    row_number() OVER (
      PARTITION BY pool."gymId"
      ORDER BY pool."createdAt", pool."id"
    ) AS position
  FROM "GymPlatePool" pool
  WHERE pool."systemBarbellFamily" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "GymEquipment" equipment
      WHERE equipment."platePoolId" = pool."id"
        AND equipment."equipmentType" = 'BARBELL'
        AND equipment."loadType" = 'PLATE_LOADED'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "GymPlatePool" managed
      WHERE managed."gymId" = pool."gymId"
        AND managed."systemBarbellFamily" = 'LARGE'
    )
)
UPDATE "GymPlatePool" pool
SET "systemBarbellFamily" = 'LARGE'
FROM candidates
WHERE pool."id" = candidates."id"
  AND candidates.position = 1;

-- Every gym always owns both profile families. Empty pools are legitimate
-- until the owner records denominations; deterministic IDs make the migration
-- safe to reason about and preserve all pre-existing rows.
INSERT INTO "GymPlatePool" (
  "id",
  "gymId",
  "name",
  "compatibilityKey",
  "systemBarbellFamily",
  "updatedAt"
)
SELECT
  'system-large-pool-' || md5(gym."id"),
  gym."id",
  'Large diameter plates (' || substr(md5(gym."id"), 1, 6) || ')',
  'system_barbell_large',
  'LARGE',
  CURRENT_TIMESTAMP
FROM "Gym" gym
WHERE NOT EXISTS (
  SELECT 1
  FROM "GymPlatePool" pool
  WHERE pool."gymId" = gym."id"
    AND pool."systemBarbellFamily" = 'LARGE'
);

INSERT INTO "GymPlatePool" (
  "id",
  "gymId",
  "name",
  "compatibilityKey",
  "systemBarbellFamily",
  "updatedAt"
)
SELECT
  'system-small-pool-' || md5(gym."id"),
  gym."id",
  'Small diameter plates (' || substr(md5(gym."id"), 1, 6) || ')',
  'system_barbell_small',
  'SMALL',
  CURRENT_TIMESTAMP
FROM "Gym" gym
WHERE NOT EXISTS (
  SELECT 1
  FROM "GymPlatePool" pool
  WHERE pool."gymId" = gym."id"
    AND pool."systemBarbellFamily" = 'SMALL'
);

-- Existing concrete bars remain the calculation source of truth and keep
-- their IDs. Olymp's 12, 17.5 and 20 kg bars therefore stay in LARGE, while
-- its 6 kg bar stays in SMALL through their existing pool assignments.
UPDATE "GymEquipment" equipment
SET "systemBarbellFamily" = pool."systemBarbellFamily"
FROM "GymPlatePool" pool
WHERE equipment."platePoolId" = pool."id"
  AND equipment."equipmentType" = 'BARBELL'
  AND equipment."loadType" = 'PLATE_LOADED'
  AND pool."systemBarbellFamily" IS NOT NULL;

-- Seed broad free-weight exercise membership once. Existing explicit
-- unavailable configs remain explicit exceptions instead of being re-enabled.
UPDATE "GymExerciseConfig" config
SET "systemProfileSupported" = CASE WHEN config."isAvailable" THEN TRUE ELSE FALSE END
FROM "Exercise" exercise
WHERE config."exerciseId" = exercise."id"
  AND exercise."equipmentType" IN ('DUMBBELL', 'BARBELL')
  AND config."systemProfileSupported" IS NULL;

INSERT INTO "GymExerciseConfig" (
  "id",
  "gymId",
  "exerciseId",
  "isAvailable",
  "weightOptions",
  "dumbbellWeights",
  "plateWeights",
  "barWeights",
  "isEquipmentMirror",
  "systemProfileSupported"
)
SELECT
  'system-profile-config-' || md5(gym."id" || ':' || exercise."id"),
  gym."id",
  exercise."id",
  TRUE,
  ARRAY[]::DOUBLE PRECISION[],
  ARRAY[]::DOUBLE PRECISION[],
  ARRAY[]::DOUBLE PRECISION[],
  ARRAY[]::DOUBLE PRECISION[],
  FALSE,
  TRUE
FROM "Gym" gym
JOIN "Exercise" exercise ON exercise."userId" = gym."userId"
WHERE exercise."equipmentType" IN ('DUMBBELL', 'BARBELL')
ON CONFLICT ("gymId", "exerciseId") DO NOTHING;

-- The aggregate Barbell exercise list is mirrored onto every managed concrete
-- bar so web and Android continue selecting a specific compatible bar/pool.
INSERT INTO "GymEquipmentExercise" (
  "equipmentId",
  "exerciseId",
  "mirrorsLegacyConfig"
)
SELECT equipment."id", config."exerciseId", FALSE
FROM "GymEquipment" equipment
JOIN "GymExerciseConfig" config ON config."gymId" = equipment."gymId"
JOIN "Exercise" exercise ON exercise."id" = config."exerciseId"
WHERE equipment."systemBarbellFamily" IS NOT NULL
  AND config."systemProfileSupported" = TRUE
  AND exercise."equipmentType" = 'BARBELL'
ON CONFLICT ("equipmentId", "exerciseId") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "GymPlatePool_gymId_systemBarbellFamily_key"
ON "GymPlatePool"("gymId", "systemBarbellFamily");

CREATE INDEX IF NOT EXISTS "GymEquipment_gymId_systemBarbellFamily_idx"
ON "GymEquipment"("gymId", "systemBarbellFamily");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GymEquipment_system_barbell_shape_check'
      AND conrelid = '"GymEquipment"'::regclass
  ) THEN
    ALTER TABLE "GymEquipment"
    ADD CONSTRAINT "GymEquipment_system_barbell_shape_check" CHECK (
      "systemBarbellFamily" IS NULL OR (
        "equipmentType" = 'BARBELL'
        AND "loadType" = 'PLATE_LOADED'
        AND "platePoolId" IS NOT NULL
      )
    );
  END IF;
END
$$;
