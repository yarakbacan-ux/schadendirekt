DO $$ BEGIN
  CREATE TYPE "VehicleOrigin" AS ENUM ('PUBLIC_LOOKUP', 'ADMIN_IMPORT', 'REPORT_PURCHASE', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "origin" "VehicleOrigin" NOT NULL DEFAULT 'SYSTEM';

CREATE INDEX IF NOT EXISTS "Vehicle_origin_idx" ON "Vehicle"("origin");

ALTER TABLE "SourceLicense"
  ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
