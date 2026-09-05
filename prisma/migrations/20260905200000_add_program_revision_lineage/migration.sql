ALTER TABLE "Program"
ADD COLUMN "parentProgramId" TEXT,
ADD COLUMN "methodologyVersion" TEXT;

CREATE INDEX "Program_parentProgramId_idx" ON "Program"("parentProgramId");

ALTER TABLE "Program"
ADD CONSTRAINT "Program_parentProgramId_fkey"
FOREIGN KEY ("parentProgramId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
