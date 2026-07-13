-- AlterTable
ALTER TABLE "Session" ADD COLUMN "sessionRpe" INTEGER;
ALTER TABLE "Set" ADD COLUMN "recoverySec" INTEGER;

-- CreateTable
CREATE TABLE "MobileAccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MobileAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileMutation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MobileMutation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MobileAccessToken_tokenHash_key" ON "MobileAccessToken"("tokenHash");
CREATE INDEX "MobileAccessToken_userId_createdAt_idx" ON "MobileAccessToken"("userId", "createdAt");
CREATE INDEX "MobileAccessToken_userId_deviceId_idx" ON "MobileAccessToken"("userId", "deviceId");
CREATE UNIQUE INDEX "MobileMutation_userId_operationId_key" ON "MobileMutation"("userId", "operationId");
CREATE INDEX "MobileMutation_userId_createdAt_idx" ON "MobileMutation"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MobileAccessToken" ADD CONSTRAINT "MobileAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MobileMutation" ADD CONSTRAINT "MobileMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
