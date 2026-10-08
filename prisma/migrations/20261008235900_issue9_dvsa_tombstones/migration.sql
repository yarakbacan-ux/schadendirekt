CREATE TABLE "SourceTombstone" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "reason" TEXT,
    "mappingVersion" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceTombstone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceTombstone_sourceId_subjectKey_key" ON "SourceTombstone"("sourceId", "subjectKey");
CREATE INDEX "SourceTombstone_sourceId_deletedAt_idx" ON "SourceTombstone"("sourceId", "deletedAt");

ALTER TABLE "SourceTombstone"
ADD CONSTRAINT "SourceTombstone_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
