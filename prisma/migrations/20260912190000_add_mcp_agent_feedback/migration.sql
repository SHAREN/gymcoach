CREATE TABLE "McpAgentFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "details" TEXT NOT NULL,
    "relatedTools" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expectedBehavior" TEXT,
    "actualBehavior" TEXT,
    "reproductionSteps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "attemptedWorkarounds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "suggestedImprovement" TEXT,
    "clientName" VARCHAR(120),
    "agentName" VARCHAR(120),
    "serverVersion" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAgentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "McpAgentFeedback_userId_createdAt_idx" ON "McpAgentFeedback"("userId", "createdAt");
CREATE INDEX "McpAgentFeedback_category_createdAt_idx" ON "McpAgentFeedback"("category", "createdAt");

ALTER TABLE "McpAgentFeedback"
ADD CONSTRAINT "McpAgentFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
