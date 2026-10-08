ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'TECHNICALLY_VALID';
ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'CONFLICTING';
ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'STALE';
ALTER TYPE "DataQuality" ADD VALUE IF NOT EXISTS 'INCOMPLETE';

ALTER TYPE "ProviderRunStatus" ADD VALUE IF NOT EXISTS 'NO_DATA';
ALTER TYPE "ProviderRunStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';

DO $$ BEGIN
  CREATE TYPE "CoverageStatus" AS ENUM ('LIVE', 'PARTIAL', 'PLANNED', 'UNAVAILABLE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ProviderAuthType" AS ENUM ('NONE', 'API_KEY', 'OAUTH2', 'OAUTH2_API_KEY', 'CONTRACT', 'BULK_FILE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "VehicleEvent"
  ADD COLUMN IF NOT EXISTS "conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "mappingVersion" TEXT;

ALTER TABLE "VehicleAttribute"
  ADD COLUMN IF NOT EXISTS "conflict" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "mappingVersion" TEXT;

ALTER TABLE "ProviderRun"
  ADD COLUMN IF NOT EXISTS "decisionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "market" TEXT,
  ADD COLUMN IF NOT EXISTS "mappingVersion" TEXT;

CREATE TABLE IF NOT EXISTS "ProviderCoverage" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "status" "CoverageStatus" NOT NULL,
  "earliestDate" TIMESTAMP(3),
  "latestDate" TIMESTAMP(3),
  "requirements" JSONB,
  "qualityNote" TEXT,
  "authType" "ProviderAuthType" NOT NULL DEFAULT 'NONE',
  "freshnessSeconds" INTEGER,
  "mappingVersion" TEXT,
  "lastSuccessfulAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCoverage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderCoverage_sourceId_market_capability_key"
  ON "ProviderCoverage"("sourceId", "market", "capability");
CREATE INDEX IF NOT EXISTS "ProviderCoverage_market_status_idx" ON "ProviderCoverage"("market", "status");
CREATE INDEX IF NOT EXISTS "ProviderCoverage_sourceId_status_idx" ON "ProviderCoverage"("sourceId", "status");
CREATE INDEX IF NOT EXISTS "VehicleEvent_conflict_idx" ON "VehicleEvent"("conflict");
CREATE INDEX IF NOT EXISTS "VehicleAttribute_conflict_idx" ON "VehicleAttribute"("conflict");

DO $$ BEGIN
  ALTER TABLE "ProviderCoverage"
    ADD CONSTRAINT "ProviderCoverage_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
