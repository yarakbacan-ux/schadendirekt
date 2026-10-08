CREATE TYPE "VehicleEventType" AS ENUM (
  'ODOMETER_READING',
  'DAMAGE_RECORD',
  'INSPECTION',
  'REGISTRATION',
  'SALE_LISTING',
  'SERVICE',
  'RECALL',
  'IMPORT_EXPORT',
  'OTHER'
);

ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "make" TEXT,
  ADD COLUMN IF NOT EXISTS "model" TEXT,
  ADD COLUMN IF NOT EXISTS "modelYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "bodyClass" TEXT,
  ADD COLUMN IF NOT EXISTS "fuelType" TEXT,
  ADD COLUMN IF NOT EXISTS "engineDisplacement" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "enginePowerKw" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "transmission" TEXT,
  ADD COLUMN IF NOT EXISTS "manufacturer" TEXT,
  ADD COLUMN IF NOT EXISTS "plantCountry" TEXT,
  ADD COLUMN IF NOT EXISTS "vehicleType" TEXT,
  ADD COLUMN IF NOT EXISTS "market" TEXT;

ALTER TABLE "VehicleEvent"
  ADD COLUMN IF NOT EXISTS "sourceEventType" TEXT;

UPDATE "VehicleEvent"
SET "sourceEventType" = "eventType"
WHERE "sourceEventType" IS NULL;

ALTER TABLE "VehicleEvent"
  ALTER COLUMN "eventType" TYPE "VehicleEventType"
  USING (
    CASE
      WHEN UPPER("eventType") IN ('ODOMETER_READING', 'ODOMETER', 'MILEAGE', 'MILEAGE_READING', 'KILOMETER', 'KILOMETERSTAND') THEN 'ODOMETER_READING'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('DAMAGE_RECORD', 'DAMAGE', 'ACCIDENT', 'CRASH', 'SCHADEN') THEN 'DAMAGE_RECORD'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('INSPECTION', 'MOT', 'TUV', 'TUEV', 'HU', 'AU') THEN 'INSPECTION'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('REGISTRATION', 'REGISTERED', 'ZULASSUNG') THEN 'REGISTRATION'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('SALE_LISTING', 'SALE', 'AUCTION', 'LISTING', 'VERKAUF') THEN 'SALE_LISTING'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('SERVICE', 'MAINTENANCE', 'REPAIR', 'WARTUNG') THEN 'SERVICE'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('RECALL', 'RUECKRUF', 'RÜCKRUF') THEN 'RECALL'::"VehicleEventType"
      WHEN UPPER("eventType") IN ('IMPORT_EXPORT', 'IMPORT', 'EXPORT', 'CUSTOMS', 'ZOLL') THEN 'IMPORT_EXPORT'::"VehicleEventType"
      ELSE 'OTHER'::"VehicleEventType"
    END
  );

ALTER TABLE "VehicleEvent"
  ALTER COLUMN "eventType" SET DEFAULT 'OTHER';

CREATE INDEX IF NOT EXISTS "VehicleEvent_eventType_idx" ON "VehicleEvent"("eventType");

CREATE TABLE IF NOT EXISTS "VehicleAttribute" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "sourceField" TEXT,
  "rawValue" TEXT,
  "quality" "DataQuality" NOT NULL DEFAULT 'UNVERIFIED',
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleAttribute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VehicleAttribute_vehicleId_sourceId_field_key"
  ON "VehicleAttribute"("vehicleId", "sourceId", "field");
CREATE INDEX IF NOT EXISTS "VehicleAttribute_vehicleId_field_idx"
  ON "VehicleAttribute"("vehicleId", "field");
CREATE INDEX IF NOT EXISTS "VehicleAttribute_sourceId_idx"
  ON "VehicleAttribute"("sourceId");

ALTER TABLE "VehicleAttribute"
  ADD CONSTRAINT "VehicleAttribute_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleAttribute"
  ADD CONSTRAINT "VehicleAttribute_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "VinDecodeCache" (
  "vin" VARCHAR(17) NOT NULL,
  "payload" JSONB NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VinDecodeCache_pkey" PRIMARY KEY ("vin")
);

CREATE INDEX IF NOT EXISTS "VinDecodeCache_expiresAt_idx" ON "VinDecodeCache"("expiresAt");
