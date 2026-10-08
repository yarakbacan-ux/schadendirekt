ALTER TABLE "ImportJob"
  ADD COLUMN IF NOT EXISTS "rowsValidated" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "ImportObject" (
  "id" TEXT NOT NULL,
  "importJobId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportObject_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ImportObject_importJobId_key" ON "ImportObject"("importJobId");
CREATE UNIQUE INDEX IF NOT EXISTS "ImportObject_storageKey_key" ON "ImportObject"("storageKey");
CREATE INDEX IF NOT EXISTS "ImportObject_expiresAt_idx" ON "ImportObject"("expiresAt");
CREATE INDEX IF NOT EXISTS "ImportObject_deletedAt_idx" ON "ImportObject"("deletedAt");

ALTER TABLE "ImportObject"
  ADD CONSTRAINT "ImportObject_importJobId_fkey"
  FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AuthAuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuthAuditLog_userId_createdAt_idx" ON "AuthAuditLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuthAuditLog_email_createdAt_idx" ON "AuthAuditLog"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "AuthAuditLog_success_createdAt_idx" ON "AuthAuditLog"("success", "createdAt");

ALTER TABLE "AuthAuditLog"
  ADD CONSTRAINT "AuthAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
