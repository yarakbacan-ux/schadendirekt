CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ANALYST', 'VIEWER');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "DataQuality" AS ENUM ('UNVERIFIED', 'PARTIAL', 'VERIFIED', 'REJECTED');

CREATE TABLE "Vehicle" (
  "id" TEXT NOT NULL,
  "vin" VARCHAR(17) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Vehicle_vin_key" ON "Vehicle"("vin");
CREATE INDEX "Vehicle_vin_idx" ON "Vehicle"("vin");

CREATE TABLE "DataSource" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DataSource_key_key" ON "DataSource"("key");

CREATE TABLE "VehicleEvent" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "externalId" TEXT,
  "eventType" TEXT NOT NULL,
  "eventDate" TIMESTAMP(3),
  "country" VARCHAR(2),
  "mileageKm" INTEGER,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "rawPayload" JSONB,
  "quality" "DataQuality" NOT NULL DEFAULT 'UNVERIFIED',
  "occurredAtText" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VehicleEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VehicleEvent_sourceId_externalId_key" ON "VehicleEvent"("sourceId", "externalId");
CREATE INDEX "VehicleEvent_vehicleId_eventDate_idx" ON "VehicleEvent"("vehicleId", "eventDate");
CREATE INDEX "VehicleEvent_sourceId_idx" ON "VehicleEvent"("sourceId");

CREATE TABLE "ImportJob" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
  "format" TEXT NOT NULL,
  "fileName" TEXT,
  "checksum" TEXT,
  "rowsRead" INTEGER NOT NULL DEFAULT 0,
  "rowsWritten" INTEGER NOT NULL DEFAULT 0,
  "errorLog" JSONB,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportJob_sourceId_createdAt_idx" ON "ImportJob"("sourceId", "createdAt");
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

CREATE TABLE "SourceLicense" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "licenseName" TEXT NOT NULL,
  "termsUrl" TEXT,
  "canStore" BOOLEAN NOT NULL DEFAULT false,
  "canRedistribute" BOOLEAN NOT NULL DEFAULT false,
  "canCommercialize" BOOLEAN NOT NULL DEFAULT false,
  "retentionDays" INTEGER,
  "notes" TEXT,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceLicense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SourceLicense_sourceId_idx" ON "SourceLicense"("sourceId");

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "VehicleEvent" ADD CONSTRAINT "VehicleEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VehicleEvent" ADD CONSTRAINT "VehicleEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SourceLicense" ADD CONSTRAINT "SourceLicense_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
