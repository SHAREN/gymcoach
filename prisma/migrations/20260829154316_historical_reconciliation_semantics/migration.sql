-- CreateEnum
CREATE TYPE "HistoricalTimePrecision" AS ENUM ('EXACT', 'DATE_ONLY');

-- CreateEnum
CREATE TYPE "SetLoadBasis" AS ENUM ('TOTAL', 'PER_SIDE', 'PER_HAND', 'STACK_DISPLAY', 'PLATE_PER_SIDE');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "historicalDate" DATE,
ADD COLUMN     "timePrecision" "HistoricalTimePrecision" NOT NULL DEFAULT 'EXACT';

-- AlterTable
ALTER TABLE "Set" ADD COLUMN     "loadBasis" "SetLoadBasis" NOT NULL DEFAULT 'TOTAL',
ADD COLUMN     "repsKnown" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "rir" TYPE DOUBLE PRECISION USING "rir"::DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ExerciseAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymEquipmentAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymEquipmentAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExerciseAlias_exerciseId_idx" ON "ExerciseAlias"("exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseAlias_userId_normalizedAlias_key" ON "ExerciseAlias"("userId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "GymEquipmentAlias_equipmentId_idx" ON "GymEquipmentAlias"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "GymEquipmentAlias_userId_gymId_normalizedAlias_key" ON "GymEquipmentAlias"("userId", "gymId", "normalizedAlias");

-- AddForeignKey
ALTER TABLE "ExerciseAlias" ADD CONSTRAINT "ExerciseAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseAlias" ADD CONSTRAINT "ExerciseAlias_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymEquipmentAlias" ADD CONSTRAINT "GymEquipmentAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymEquipmentAlias" ADD CONSTRAINT "GymEquipmentAlias_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymEquipmentAlias" ADD CONSTRAINT "GymEquipmentAlias_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "GymEquipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "McpOperationAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" VARCHAR(80) NOT NULL,
    "reason" TEXT,
    "request" JSONB,
    "result" JSONB,
    "undoSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "McpOperationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpOperationAudit_userId_createdAt_idx" ON "McpOperationAudit"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "McpOperationAudit" ADD CONSTRAINT "McpOperationAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
