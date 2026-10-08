CREATE TYPE "ProviderRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

CREATE TABLE "ProviderRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "vin" VARCHAR(17),
    "status" "ProviderRunStatus" NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderRun_sourceId_finishedAt_idx" ON "ProviderRun"("sourceId", "finishedAt");
CREATE INDEX "ProviderRun_status_finishedAt_idx" ON "ProviderRun"("status", "finishedAt");
CREATE INDEX "ProviderRun_vin_idx" ON "ProviderRun"("vin");

ALTER TABLE "ProviderRun" ADD CONSTRAINT "ProviderRun_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
