ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

ALTER TABLE "VehicleEvent"
  ADD COLUMN IF NOT EXISTS "rawPayloadExpiresAt" TIMESTAMP(3);

ALTER TABLE "ImportJob"
  ADD COLUMN IF NOT EXISTS "rowsFailed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ImportPayload" (
  "id" TEXT NOT NULL,
  "importJobId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportPayload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ImportPayload_importJobId_key" ON "ImportPayload"("importJobId");
CREATE INDEX IF NOT EXISTS "ImportPayload_expiresAt_idx" ON "ImportPayload"("expiresAt");
CREATE INDEX IF NOT EXISTS "VehicleEvent_rawPayloadExpiresAt_idx" ON "VehicleEvent"("rawPayloadExpiresAt");
CREATE INDEX IF NOT EXISTS "ImportJob_checksum_idx" ON "ImportJob"("checksum");
CREATE INDEX IF NOT EXISTS "SourceLicense_validFrom_validUntil_idx" ON "SourceLicense"("validFrom", "validUntil");

ALTER TABLE "ImportPayload"
  ADD CONSTRAINT "ImportPayload_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "csrfTokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
