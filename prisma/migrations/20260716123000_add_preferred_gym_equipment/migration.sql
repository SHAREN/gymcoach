-- Store one preferred concrete equipment item per gym and exercise while
-- preserving the existing many-to-many compatibility links.
ALTER TABLE "GymExerciseConfig"
ADD COLUMN "preferredEquipmentId" TEXT;

CREATE INDEX "GymExerciseConfig_preferredEquipmentId_idx"
ON "GymExerciseConfig"("preferredEquipmentId");

ALTER TABLE "GymExerciseConfig"
ADD CONSTRAINT "GymExerciseConfig_preferredEquipmentId_fkey"
FOREIGN KEY ("preferredEquipmentId") REFERENCES "GymEquipment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
