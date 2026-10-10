import { createHash } from 'node:crypto';
import type { ProviderAttribute, ProviderEvent, ProviderLookupResult } from '@/lib/providers/types';
import type { DvsaDefect, DvsaMotTest, DvsaVehicle } from '@/lib/dvsa-types';

const MI_TO_KM = 1.609344;

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
}

function dateOrNull(value: unknown): Date | null {
  const text = clean(value);
  if (!text) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + 'Z' : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeDvsaOdometer(value: unknown, unit: unknown): {
  originalValue: string | null;
  originalUnit: string | null;
  mileageKm: number | null;
} {
  const originalValue = clean(value);
  const originalUnit = clean(unit)?.toUpperCase() ?? null;
  if (!originalValue || !originalUnit) return { originalValue, originalUnit, mileageKm: null };
  const numeric = Number(originalValue.replace(/,/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) return { originalValue, originalUnit, mileageKm: null };
  if (originalUnit === 'KM') return { originalValue, originalUnit, mileageKm: Math.round(numeric) };
  if (originalUnit === 'MI') return { originalValue, originalUnit, mileageKm: Math.round(numeric * MI_TO_KM) };
  return { originalValue, originalUnit, mileageKm: null };
}

function normalizedDefects(defects: DvsaDefect[] | null | undefined) {
  return (defects ?? []).map((defect) => ({
    text: clean(defect.text) ?? '',
    type: clean(defect.type)?.toUpperCase() ?? 'UNKNOWN',
    dangerous: defect.dangerous === true
  }));
}

function fallbackTestFingerprint(test: DvsaMotTest): string {
  const defects = normalizedDefects(test.defects)
    .map((defect) => `${defect.type}|${defect.dangerous ? '1' : '0'}|${defect.text}`)
    .sort();
  const stableFields = {
    completedDate: clean(test.completedDate),
    expiryDate: clean(test.expiryDate),
    testResult: clean(test.testResult)?.toUpperCase() ?? null,
    registrationAtTimeOfTest: clean(test.regMarkTimeOfTest ?? test.registrationAtTimeOfTest)?.toUpperCase() ?? null,
    odometerValue: clean(test.odometerValue),
    odometerUnit: clean(test.odometerUnit)?.toUpperCase() ?? null,
    odometerResultType: clean(test.odometerResultType)?.toUpperCase() ?? null,
    dataSource: clean(test.dataSource),
    defects
  };
  return createHash('sha256').update(JSON.stringify(stableFields)).digest('hex').slice(0, 32);
}

function testExternalId(test: DvsaMotTest): string {
  const number = clean(test.motTestNumber);
  if (number) return `mot:${number}`;
  return `mot:fallback:${fallbackTestFingerprint(test)}`;
}

function testTitle(test: DvsaMotTest) {
  const result = clean(test.testResult)?.toUpperCase();
  if (result === 'PASSED') return 'MOT-Prüfung bestanden';
  if (result === 'FAILED') return 'MOT-Prüfung nicht bestanden';
  return 'MOT-Prüfung';
}

function testDescription(test: DvsaMotTest, defects: ReturnType<typeof normalizedDefects>) {
  const result = clean(test.testResult)?.toUpperCase() ?? 'UNBEKANNT';
  const expiry = clean(test.expiryDate);
  const defectSummary = defects.length === 0
    ? 'Keine Mängeldetails geliefert.'
    : `${defects.length} Mangel/Hinweis-Einträge, davon ${defects.filter((item) => item.dangerous || item.type === 'DANGEROUS').length} gefährlich.`;
  return `MOT-Ergebnis: ${result}.${expiry ? ` Ablaufdatum: ${expiry}.` : ''} ${defectSummary}`;
}

function vehicleAttributes(vehicle: DvsaVehicle, fetchedAt: Date): ProviderAttribute[] {
  const pairs: Array<[string, unknown, string, 'VEHICLE_SPECS' | 'REGISTRATION']> = [
    ['make', vehicle.make, 'make', 'VEHICLE_SPECS'],
    ['model', vehicle.model, 'model', 'VEHICLE_SPECS'],
    ['fuelType', vehicle.fuelType, 'fuelType', 'VEHICLE_SPECS'],
    ['registration', vehicle.registration, 'registration', 'REGISTRATION'],
    ['firstUsedDate', vehicle.firstUsedDate, 'firstUsedDate', 'REGISTRATION'],
    ['registrationDate', vehicle.registrationDate, 'registrationDate', 'REGISTRATION'],
    ['manufactureDate', vehicle.manufactureDate, 'manufactureDate', 'VEHICLE_SPECS'],
    ['primaryColour', vehicle.primaryColour, 'primaryColour', 'VEHICLE_SPECS'],
    ['secondaryColour', vehicle.secondaryColour, 'secondaryColour', 'VEHICLE_SPECS']
  ];

  const attributes = pairs.flatMap(([field, raw, sourceField, capability]) => {
    const value = clean(raw);
    return value ? [{ field, value, sourceField, rawValue: value, capability, quality: 'VERIFIED' as const, fetchedAt }] : [];
  });

  const engineSize = clean(vehicle.engineSize);
  if (engineSize) {
    const cc = Number(engineSize);
    if (Number.isFinite(cc) && cc > 0) {
      attributes.push({
        field: 'engineDisplacement',
        value: String(Math.round((cc / 1000) * 1000) / 1000),
        sourceField: 'engineSize',
        rawValue: engineSize,
        capability: 'VEHICLE_SPECS',
        quality: 'VERIFIED',
        fetchedAt
      });
    }
  }
  return attributes;
}

export function mapDvsaVehicle(vehicle: DvsaVehicle, fetchedAt = new Date()): ProviderLookupResult {
  const attributes = vehicleAttributes(vehicle, fetchedAt);
  const events: ProviderEvent[] = (vehicle.motTests ?? []).map((test) => {
    const odometer = normalizeDvsaOdometer(test.odometerValue, test.odometerUnit);
    const defects = normalizedDefects(test.defects);
    const testResult = clean(test.testResult)?.toUpperCase() ?? null;
    return {
      externalId: testExternalId(test),
      eventType: 'INSPECTION',
      sourceEventType: testResult ? `MOT_${testResult}` : 'MOT',
      eventDate: dateOrNull(test.completedDate),
      country: 'GB',
      mileageKm: odometer.mileageKm,
      title: testTitle(test),
      description: testDescription(test, defects),
      quality: 'VERIFIED',
      rawPayload: {
        motTestNumber: clean(test.motTestNumber),
        completedDate: clean(test.completedDate),
        expiryDate: clean(test.expiryDate),
        testResult,
        registrationAtTimeOfTest: clean(test.regMarkTimeOfTest ?? test.registrationAtTimeOfTest),
        odometer: {
          originalValue: odometer.originalValue,
          originalUnit: odometer.originalUnit,
          resultType: clean(test.odometerResultType),
          mileageKm: odometer.mileageKm
        },
        defects,
        dataSource: clean(test.dataSource)
      },
      rawPayloadCapabilities: {
        motTestNumber: 'INSPECTION',
        completedDate: 'INSPECTION',
        expiryDate: 'INSPECTION',
        testResult: 'INSPECTION',
        registrationAtTimeOfTest: 'REGISTRATION',
        odometer: 'ODOMETER',
        defects: 'INSPECTION',
        dataSource: 'INSPECTION'
      }
    };
  });

  return { cached: false, attributes, events };
}

export function getDvsaModification(record: DvsaVehicle): 'CREATED' | 'UPDATED' | 'DELETED' | 'UNKNOWN' {
  const value = clean(record.modification ?? record.last_modification)?.toUpperCase();
  if (value === 'CREATED' || value === 'UPDATED' || value === 'DELETED') return value;
  return 'UNKNOWN';
}
