-- Stage 4 equipment media: user-owned canonical templates plus multi-image galleries.
-- Legacy GymEquipment single-image columns intentionally remain for compatibility.

ALTER TABLE "GymEquipment" ADD COLUMN "templateId" TEXT;

CREATE TABLE "EquipmentTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "equipmentType" "EquipmentType" NOT NULL,
    "description" TEXT,
    "manufacturer" TEXT,
    "modelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EquipmentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EquipmentTemplateImage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageData" BYTEA,
    "imageMimeType" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EquipmentTemplateImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymEquipmentImage" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageData" BYTEA,
    "imageMimeType" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sourceMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GymEquipmentImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentTemplate_userId_name_key" ON "EquipmentTemplate"("userId", "name");
CREATE INDEX "EquipmentTemplate_userId_equipmentType_idx" ON "EquipmentTemplate"("userId", "equipmentType");
CREATE INDEX "EquipmentTemplateImage_templateId_isPrimary_createdAt_idx" ON "EquipmentTemplateImage"("templateId", "isPrimary", "createdAt");
CREATE INDEX "GymEquipmentImage_equipmentId_isPrimary_createdAt_idx" ON "GymEquipmentImage"("equipmentId", "isPrimary", "createdAt");
CREATE INDEX "GymEquipment_templateId_idx" ON "GymEquipment"("templateId");

ALTER TABLE "EquipmentTemplate" ADD CONSTRAINT "EquipmentTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EquipmentTemplateImage" ADD CONSTRAINT "EquipmentTemplateImage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EquipmentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymEquipmentImage" ADD CONSTRAINT "GymEquipmentImage_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "GymEquipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EquipmentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve every pre-gallery concrete image as the first explicit gym-specific primary.
INSERT INTO "GymEquipmentImage" (
    "id", "equipmentId", "imageUrl", "imageData", "imageMimeType", "isPrimary", "sourceMeta", "createdAt", "updatedAt"
)
SELECT
    'legacy_' || "id",
    "id",
    "imageUrl",
    "imageData",
    "imageMimeType",
    true,
    '{"origin":"legacy-single-image"}'::jsonb,
    "updatedAt",
    "updatedAt"
FROM "GymEquipment"
WHERE "imageUrl" IS NOT NULL OR ("imageData" IS NOT NULL AND "imageMimeType" IS NOT NULL);
