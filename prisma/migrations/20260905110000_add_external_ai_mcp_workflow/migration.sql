ALTER TABLE "GymEquipment"
ADD COLUMN "loadConfigurationKnown" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "McpMutation" (
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
CREATE UNIQUE INDEX "McpMutation_userId_operationId_key" ON "McpMutation"("userId", "operationId");
CREATE INDEX "McpMutation_userId_createdAt_idx" ON "McpMutation"("userId", "createdAt");
ALTER TABLE "McpMutation" ADD CONSTRAINT "McpMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
