ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'STALE';
ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'INCOMPLETE';
ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'CONFLICTING';

CREATE TYPE "CoverageStatus" AS ENUM ('LIVE', 'PARTIAL', 'PLANNED', 'UNAVAILABLE');

ALTER TABLE "VehicleEvent"
  ADD COLUMN "mappingVersion" TEXT NOT NULL DEFAULT '1';

ALTER TABLE "VehicleAttribute"
  ADD COLUMN "mappingVersion" TEXT NOT NULL DEFAULT '1';

ALTER TABLE "DataSource"
  ADD COLUMN "authType" TEXT,
  ADD COLUMN "refreshPolicy" TEXT,
  ADD COLUMN "rateLimitPolicy" TEXT,
  ADD COLUMN "mappingVersion" TEXT NOT NULL DEFAULT '1';

ALTER TABLE "ProviderRun"
  ADD COLUMN "decisionReason" TEXT,
  ADD COLUMN "mappingVersion" TEXT;

CREATE TABLE "ProviderCoverage" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "marketCode" VARCHAR(16) NOT NULL,
  "capabilities" TEXT[] NOT NULL,
  "status" "CoverageStatus" NOT NULL,
  "earliestDate" TIMESTAMP(3),
  "latestDate" TIMESTAMP(3),
  "requiresCredentials" BOOLEAN NOT NULL DEFAULT false,
  "requiresContract" BOOLEAN NOT NULL DEFAULT false,
  "requiresLicense" BOOLEAN NOT NULL DEFAULT false,
  "freshnessHours" INTEGER,
  "lastSuccessfulAt" TIMESTAMP(3),
  "qualityNote" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCoverage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceMappingVersion" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "mapping" JSONB NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reprocessingNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceMappingVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCoverage_sourceId_marketCode_key" ON "ProviderCoverage"("sourceId", "marketCode");
CREATE INDEX "ProviderCoverage_marketCode_status_idx" ON "ProviderCoverage"("marketCode", "status");
CREATE INDEX "ProviderCoverage_sourceId_status_idx" ON "ProviderCoverage"("sourceId", "status");

CREATE UNIQUE INDEX "SourceMappingVersion_sourceId_version_key" ON "SourceMappingVersion"("sourceId", "version");
CREATE INDEX "SourceMappingVersion_sourceId_effectiveFrom_idx" ON "SourceMappingVersion"("sourceId", "effectiveFrom");

CREATE INDEX "VehicleEvent_sourceId_mappingVersion_idx" ON "VehicleEvent"("sourceId", "mappingVersion");
CREATE INDEX "VehicleAttribute_sourceId_mappingVersion_idx" ON "VehicleAttribute"("sourceId", "mappingVersion");
CREATE INDEX "ProviderRun_sourceId_vin_finishedAt_idx" ON "ProviderRun"("sourceId", "vin", "finishedAt");

ALTER TABLE "ProviderCoverage"
  ADD CONSTRAINT "ProviderCoverage_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceMappingVersion"
  ADD CONSTRAINT "SourceMappingVersion_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
