ALTER TABLE "ImportJob"
  ADD COLUMN IF NOT EXISTS "mappingVersion" TEXT NOT NULL DEFAULT 'generic-import-v1';

CREATE INDEX IF NOT EXISTS "ImportJob_sourceId_checksum_mappingVersion_idx"
  ON "ImportJob"("sourceId", "checksum", "mappingVersion");

CREATE TABLE IF NOT EXISTS "SourceContract" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "reference" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceContract_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SourceContract_sourceId_active_idx"
  ON "SourceContract"("sourceId", "active");
CREATE INDEX IF NOT EXISTS "SourceContract_validFrom_validUntil_idx"
  ON "SourceContract"("validFrom", "validUntil");

DO $$ BEGIN
  ALTER TABLE "SourceContract"
    ADD CONSTRAINT "SourceContract_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
