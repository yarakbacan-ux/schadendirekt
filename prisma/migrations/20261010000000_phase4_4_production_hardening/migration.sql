ALTER TABLE "VehicleAttribute" ADD COLUMN "capability" TEXT;
CREATE INDEX "VehicleAttribute_capability_idx" ON "VehicleAttribute"("capability");

ALTER TABLE "ImportObject"
  ALTER COLUMN "sizeBytes" TYPE BIGINT
  USING "sizeBytes"::bigint;

CREATE TABLE "ImportAuditLog" (
  "id" TEXT NOT NULL,
  "importJobId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromMappingVersion" TEXT,
  "toMappingVersion" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportAuditLog_importJobId_createdAt_idx" ON "ImportAuditLog"("importJobId", "createdAt");
CREATE INDEX "ImportAuditLog_action_createdAt_idx" ON "ImportAuditLog"("action", "createdAt");

ALTER TABLE "ImportAuditLog"
  ADD CONSTRAINT "ImportAuditLog_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
