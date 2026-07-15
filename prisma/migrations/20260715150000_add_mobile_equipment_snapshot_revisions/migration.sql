-- Preserve a server-authenticated equipment configuration after the live
-- GymEquipment row changes or is deleted while an Android workout is offline.
CREATE TABLE "MobileEquipmentSnapshotRevision" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "equipmentNameSnapshot" TEXT NOT NULL,
    "equipmentType" "EquipmentType" NOT NULL,
    "loadType" "EquipmentLoadType" NOT NULL,
    "selectedLoadMultiplier" DOUBLE PRECISION NOT NULL,
    "baseLoadKg" DOUBLE PRECISION NOT NULL,
    "loadingSides" INTEGER NOT NULL,
    "weightOptions" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "platePoolIdSnapshot" TEXT,
    "platePoolNameSnapshot" TEXT,
    "platePoolCompatibilityKeySnapshot" TEXT,
    "plateInventorySnapshot" JSONB,
    "exerciseIds" TEXT[],
    "configHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileEquipmentSnapshotRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileEquipmentSnapshotRevision_equipmentId_configHash_key"
ON "MobileEquipmentSnapshotRevision"("equipmentId", "configHash");

CREATE INDEX "MobileEquipmentSnapshotRevision_gymId_equipmentId_idx"
ON "MobileEquipmentSnapshotRevision"("gymId", "equipmentId");

ALTER TABLE "MobileEquipmentSnapshotRevision"
ADD CONSTRAINT "MobileEquipmentSnapshotRevision_gymId_fkey"
FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;
