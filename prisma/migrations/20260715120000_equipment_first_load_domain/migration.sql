-- Equipment-first inventory is additive. Existing gyms keep legacy behavior
-- until their inventory is explicitly migrated by the application.
CREATE TYPE "GymInventoryMode" AS ENUM ('LEGACY', 'EQUIPMENT_FIRST');
CREATE TYPE "EquipmentLoadType" AS ENUM ('NONE', 'FIXED', 'SELECTORIZED', 'PLATE_LOADED');

ALTER TABLE "Gym"
ADD COLUMN "inventoryMode" "GymInventoryMode" NOT NULL DEFAULT 'EQUIPMENT_FIRST';

UPDATE "Gym" SET "inventoryMode" = 'LEGACY';

CREATE TABLE "GymPlatePool" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "compatibilityKey" TEXT NOT NULL,
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

ALTER TABLE "GymEquipment"
ADD COLUMN "loadType" "EquipmentLoadType" NOT NULL DEFAULT 'NONE',
ADD COLUMN "selectedLoadMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "baseLoadKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "platePoolId" TEXT,
ADD COLUMN "loadingSides" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "GymEquipment"
ADD CONSTRAINT "GymEquipment_selectedLoadMultiplier_check" CHECK ("selectedLoadMultiplier" > 0),
ADD CONSTRAINT "GymEquipment_baseLoadKg_check" CHECK ("baseLoadKg" >= 0),
ADD CONSTRAINT "GymEquipment_loadingSides_check" CHECK ("loadingSides" > 0);

ALTER TABLE "GymPlateInventoryItem"
ADD CONSTRAINT "GymPlateInventoryItem_weightKg_check" CHECK ("weightKg" > 0),
ADD CONSTRAINT "GymPlateInventoryItem_quantity_check" CHECK ("quantity" IS NULL OR "quantity" >= 0);

-- Preserve the meaning of existing machine/cable weightOptions as displayed
-- selectorized positions. Other equipment remains NONE until configured.
UPDATE "GymEquipment"
SET "loadType" = 'SELECTORIZED'
WHERE "equipmentType" IN ('MACHINE', 'CABLE')
  AND cardinality("weightOptions") > 0;

ALTER TABLE "Set"
ADD COLUMN "gymEquipmentId" TEXT,
ADD COLUMN "equipmentNameSnapshot" TEXT,
ADD COLUMN "selectedLoadKg" DOUBLE PRECISION,
ADD COLUMN "selectedLoadMultiplierSnapshot" DOUBLE PRECISION,
ADD COLUMN "nominalResistanceKg" DOUBLE PRECISION,
ADD COLUMN "equipmentLoadSnapshot" JSONB;

CREATE UNIQUE INDEX "GymPlatePool_gymId_name_key" ON "GymPlatePool"("gymId", "name");
CREATE UNIQUE INDEX "GymPlatePool_gymId_compatibilityKey_key" ON "GymPlatePool"("gymId", "compatibilityKey");
CREATE INDEX "GymPlatePool_gymId_updatedAt_idx" ON "GymPlatePool"("gymId", "updatedAt");
CREATE UNIQUE INDEX "GymPlateInventoryItem_poolId_weightKg_key" ON "GymPlateInventoryItem"("poolId", "weightKg");
CREATE INDEX "GymPlateInventoryItem_poolId_idx" ON "GymPlateInventoryItem"("poolId");
CREATE INDEX "GymEquipment_platePoolId_idx" ON "GymEquipment"("platePoolId");
CREATE INDEX "Set_gymEquipmentId_completedAt_idx" ON "Set"("gymEquipmentId", "completedAt");

ALTER TABLE "GymPlatePool"
ADD CONSTRAINT "GymPlatePool_gymId_fkey"
FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GymPlateInventoryItem"
ADD CONSTRAINT "GymPlateInventoryItem_poolId_fkey"
FOREIGN KEY ("poolId") REFERENCES "GymPlatePool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GymEquipment"
ADD CONSTRAINT "GymEquipment_platePoolId_fkey"
FOREIGN KEY ("platePoolId") REFERENCES "GymPlatePool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Set"
ADD CONSTRAINT "Set_gymEquipmentId_fkey"
FOREIGN KEY ("gymEquipmentId") REFERENCES "GymEquipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate legacy gym-wide denominations into one universal compatibility pool.
-- Quantity remains NULL because the old schema never recorded physical counts.
INSERT INTO "GymPlatePool" ("id", "gymId", "name", "compatibilityKey", "updatedAt")
SELECT 'legacy-plates-' || "id", "id", 'Legacy shared plates', 'legacy-default', CURRENT_TIMESTAMP
FROM "Gym"
WHERE cardinality("plateWeights") > 0;

INSERT INTO "GymPlateInventoryItem" ("id", "poolId", "weightKg", "quantity")
SELECT
  'legacy-plate-' || md5(gym."id" || ':' || plate."weightKg"::text),
  'legacy-plates-' || gym."id",
  plate."weightKg",
  NULL
FROM "Gym" gym
CROSS JOIN LATERAL unnest(gym."plateWeights") AS plate("weightKg")
WHERE plate."weightKg" > 0
ON CONFLICT ("poolId", "weightKg") DO NOTHING;
