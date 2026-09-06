CREATE TYPE "EquipmentLoadType" AS ENUM ('NONE', 'FIXED', 'SELECTORIZED', 'PLATE_LOADED');
CREATE TYPE "BarbellDiameterFamily" AS ENUM ('LARGE', 'SMALL');

ALTER TABLE "GymExerciseConfig"
ADD COLUMN "systemProfileSupported" BOOLEAN;

ALTER TABLE "GymEquipment"
ADD COLUMN "loadType" "EquipmentLoadType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "selectedLoadMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "baseLoadKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "platePoolId" TEXT,
ADD COLUMN "loadingSides" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "systemBarbellFamily" "BarbellDiameterFamily";

CREATE TABLE "GymPlatePool" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "compatibilityKey" TEXT NOT NULL,
    "systemBarbellFamily" "BarbellDiameterFamily",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GymPlatePool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymPlateInventoryItem" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER,
    CONSTRAINT "GymPlateInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GymPlatePool_gymId_name_key" ON "GymPlatePool"("gymId", "name");
CREATE UNIQUE INDEX "GymPlatePool_gymId_compatibilityKey_key" ON "GymPlatePool"("gymId", "compatibilityKey");
CREATE UNIQUE INDEX "GymPlatePool_gymId_systemBarbellFamily_key" ON "GymPlatePool"("gymId", "systemBarbellFamily");
CREATE INDEX "GymPlatePool_gymId_updatedAt_idx" ON "GymPlatePool"("gymId", "updatedAt");
CREATE UNIQUE INDEX "GymPlateInventoryItem_poolId_weightKg_key" ON "GymPlateInventoryItem"("poolId", "weightKg");
CREATE INDEX "GymPlateInventoryItem_poolId_idx" ON "GymPlateInventoryItem"("poolId");
CREATE INDEX "GymEquipment_gymId_systemBarbellFamily_idx" ON "GymEquipment"("gymId", "systemBarbellFamily");
CREATE INDEX "GymEquipment_platePoolId_idx" ON "GymEquipment"("platePoolId");

ALTER TABLE "GymPlatePool" ADD CONSTRAINT "GymPlatePool_gymId_fkey"
FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymPlateInventoryItem" ADD CONSTRAINT "GymPlateInventoryItem_poolId_fkey"
FOREIGN KEY ("poolId") REFERENCES "GymPlatePool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_platePoolId_fkey"
FOREIGN KEY ("platePoolId") REFERENCES "GymPlatePool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing machine/cable/other weightOptions were explicit selectable load
-- lists before permanent system profiles existed. Promote only those already-known rows to the
-- structured SELECTORIZED type; UNKNOWN configurations remain untouched.
UPDATE "GymEquipment"
SET "loadType" = 'SELECTORIZED'::"EquipmentLoadType"
WHERE "loadConfigurationKnown" = TRUE
  AND cardinality("weightOptions") > 0
  AND "equipmentType" IN (
    'MACHINE'::"EquipmentType",
    'CABLE'::"EquipmentType",
    'OTHER'::"EquipmentType"
  );

-- Every gym receives the two permanent Barbell compatibility families. Their
-- names include a stable suffix so migration cannot collide with a user pool.
INSERT INTO "GymPlatePool" (
    "id", "gymId", "name", "compatibilityKey", "systemBarbellFamily", "updatedAt"
)
SELECT
    'sys-pool-large-' || md5(g."id"),
    g."id",
    'Large diameter plates (system ' || substr(md5(g."id"), 1, 6) || ')',
    'system_barbell_large',
    'LARGE'::"BarbellDiameterFamily",
    CURRENT_TIMESTAMP
FROM "Gym" g;

INSERT INTO "GymPlatePool" (
    "id", "gymId", "name", "compatibilityKey", "systemBarbellFamily", "updatedAt"
)
SELECT
    'sys-pool-small-' || md5(g."id"),
    g."id",
    'Small diameter plates (system ' || substr(md5(g."id"), 1, 6) || ')',
    'system_barbell_small',
    'SMALL'::"BarbellDiameterFamily",
    CURRENT_TIMESTAMP
FROM "Gym" g;

-- Legacy shared plate denominations were already treated as a two-sided
-- Barbell pool. Preserve exactly those known denominations; physical counts
-- were never recorded, so quantity remains NULL rather than being invented.
INSERT INTO "GymPlateInventoryItem" ("id", "poolId", "weightKg", "quantity")
SELECT
    'sys-plate-' || md5(g."id" || ':' || p.weight::text),
    'sys-pool-large-' || md5(g."id"),
    p.weight,
    NULL
FROM "Gym" g
CROSS JOIN LATERAL (
    SELECT DISTINCT value AS weight
    FROM unnest(g."plateWeights") value
    WHERE value > 0
) p;

-- Legacy shared bar weights were explicit facts. Materialize only those bars;
-- the small-diameter family intentionally starts empty rather than inventing
-- a bar that the trainee never recorded.
INSERT INTO "GymEquipment" (
    "id", "gymId", "name", "equipmentType", "quantity",
    "loadConfigurationKnown", "loadType", "weightOptions",
    "selectedLoadMultiplier", "baseLoadKg", "platePoolId", "loadingSides",
    "systemBarbellFamily", "createdAt", "updatedAt"
)
SELECT
    'sys-bar-large-' || md5(g."id" || ':' || b.weight::text),
    g."id",
    'System large bar ' || trim(to_char(b.weight, 'FM999999990.00')) || ' kg (' || substr(md5(g."id"), 1, 6) || ')',
    'BARBELL'::"EquipmentType",
    1,
    TRUE,
    'PLATE_LOADED'::"EquipmentLoadType",
    ARRAY[]::DOUBLE PRECISION[],
    1,
    b.weight,
    'sys-pool-large-' || md5(g."id"),
    2,
    'LARGE'::"BarbellDiameterFamily",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Gym" g
CROSS JOIN LATERAL (
    SELECT DISTINCT value AS weight
    FROM unnest(g."barWeights") value
    WHERE value > 0
) b;

-- Existing explicit availability for free-weight exercises becomes initial
-- system-profile membership. Missing configs preserve the old implicit
-- availability semantics by creating an explicit supported row.
UPDATE "GymExerciseConfig" cfg
SET "systemProfileSupported" = cfg."isAvailable"
FROM "Exercise" e
WHERE cfg."exerciseId" = e."id"
  AND e."equipmentType" IN ('DUMBBELL'::"EquipmentType", 'BARBELL'::"EquipmentType")
  AND cfg."systemProfileSupported" IS NULL;

INSERT INTO "GymExerciseConfig" (
    "id", "gymId", "exerciseId", "isAvailable", "weightOptions", "systemProfileSupported"
)
SELECT
    'sys-config-' || md5(g."id" || ':' || e."id"),
    g."id",
    e."id",
    TRUE,
    ARRAY[]::DOUBLE PRECISION[],
    TRUE
FROM "Gym" g
JOIN "Exercise" e ON e."userId" = g."userId"
WHERE e."equipmentType" IN ('DUMBBELL'::"EquipmentType", 'BARBELL'::"EquipmentType")
  AND NOT EXISTS (
      SELECT 1 FROM "GymExerciseConfig" cfg
      WHERE cfg."gymId" = g."id" AND cfg."exerciseId" = e."id"
  );

-- Managed bars are linked only to explicitly supported BARBELL exercises in
-- their gym. This is deterministic compatibility data, not semantic inference.
INSERT INTO "GymEquipmentExercise" ("equipmentId", "exerciseId")
SELECT bar."id", cfg."exerciseId"
FROM "GymEquipment" bar
JOIN "GymExerciseConfig" cfg ON cfg."gymId" = bar."gymId"
JOIN "Exercise" e ON e."id" = cfg."exerciseId"
WHERE bar."systemBarbellFamily" IS NOT NULL
  AND cfg."systemProfileSupported" = TRUE
  AND e."equipmentType" = 'BARBELL'::"EquipmentType"
ON CONFLICT DO NOTHING;
