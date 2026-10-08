-- Phase 4.3: provider freshness scope + market/capability policy scope

ALTER TABLE "SourceLicense"
  ADD COLUMN IF NOT EXISTS "markets" JSONB,
  ADD COLUMN IF NOT EXISTS "capabilities" JSONB;

ALTER TABLE "SourceContract"
  ADD COLUMN IF NOT EXISTS "markets" JSONB,
  ADD COLUMN IF NOT EXISTS "capabilities" JSONB;

CREATE TABLE IF NOT EXISTS "ProviderRunCapability" (
  "id" TEXT NOT NULL,
  "providerRunId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "mappingVersion" TEXT NOT NULL,
  "status" "ProviderRunStatus" NOT NULL,
  "decisionReason" TEXT,
  "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderRunCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderRunCapability_providerRunId_capability_key"
  ON "ProviderRunCapability"("providerRunId", "capability");
CREATE INDEX IF NOT EXISTS "ProviderRunCapability_capability_market_mappingVersion_finishedAt_idx"
  ON "ProviderRunCapability"("capability", "market", "mappingVersion", "finishedAt");
CREATE INDEX IF NOT EXISTS "ProviderRunCapability_status_finishedAt_idx"
  ON "ProviderRunCapability"("status", "finishedAt");
CREATE INDEX IF NOT EXISTS "ProviderRun_sourceId_vin_market_mappingVersion_finishedAt_idx"
  ON "ProviderRun"("sourceId", "vin", "market", "mappingVersion", "finishedAt");

DO $$ BEGIN
  ALTER TABLE "ProviderRunCapability"
    ADD CONSTRAINT "ProviderRunCapability_providerRunId_fkey"
    FOREIGN KEY ("providerRunId") REFERENCES "ProviderRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
