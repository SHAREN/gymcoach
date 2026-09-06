-- Non-destructive bridge from the legacy SHAREN production schema to the clean
-- web/server schema. Run only after a verified database backup. This script
-- intentionally leaves legacy/mobile-only tables and columns untouched.
BEGIN;

-- The legacy equipment-first schema already stores deterministic load facts but
-- predates the explicit known/unknown marker. Preserve only provable facts:
-- configured load types or non-default structured load fields are known;
-- rows that contain only legacy defaults remain unknown.
ALTER TABLE "GymEquipment"
ADD COLUMN IF NOT EXISTS "loadConfigurationKnown" BOOLEAN;

UPDATE "GymEquipment"
SET "loadConfigurationKnown" = (
  "loadType" <> 'NONE'::"EquipmentLoadType"
  OR cardinality("weightOptions") > 0
  OR "selectedLoadMultiplier" <> 1
  OR "baseLoadKg" <> 0
  OR "platePoolId" IS NOT NULL
  OR "loadingSides" <> 2
  OR "systemBarbellFamily" IS NOT NULL
)
WHERE "loadConfigurationKnown" IS NULL;

ALTER TABLE "GymEquipment"
ALTER COLUMN "loadConfigurationKnown" SET DEFAULT true,
ALTER COLUMN "loadConfigurationKnown" SET NOT NULL;

-- Clean MCP writes use a separate idempotency table. Legacy MobileMutation is
-- retained unchanged because Android/mobile history is archival data and is not
-- part of the clean web runtime.
CREATE TABLE IF NOT EXISTS "McpMutation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpMutation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "McpMutation_userId_operationId_key"
ON "McpMutation"("userId", "operationId");

CREATE INDEX IF NOT EXISTS "McpMutation_userId_createdAt_idx"
ON "McpMutation"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'McpMutation_userId_fkey'
      AND conrelid = '"McpMutation"'::regclass
  ) THEN
    ALTER TABLE "McpMutation"
    ADD CONSTRAINT "McpMutation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;
