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

function testExternalId(test: DvsaMotTest, index: number): string {
  const number = clean(test.motTestNumber);
  if (number) return `mot:${number}`;
  const completed = clean(test.completedDate) ?? 'unknown-date';
  const registration = clean(test.regMarkTimeOfTest ?? test.registrationAtTimeOfTest) ?? 'unknown-reg';
  return `mot:fallback:${completed}:${registration}:${index}`;
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
  const pairs: Array<[string, unknown, string]> = [
    ['make', vehicle.make, 'make'],
    ['model', vehicle.model, 'model'],
    ['fuelType', vehicle.fuelType, 'fuelType'],
    ['registration', vehicle.registration, 'registration'],
    ['firstUsedDate', vehicle.firstUsedDate, 'firstUsedDate'],
    ['registrationDate', vehicle.registrationDate, 'registrationDate'],
    ['manufactureDate', vehicle.manufactureDate, 'manufactureDate'],
    ['primaryColour', vehicle.primaryColour, 'primaryColour'],
    ['secondaryColour', vehicle.secondaryColour, 'secondaryColour']
  ];

  const attributes = pairs.flatMap(([field, raw, sourceField]) => {
    const value = clean(raw);
    return value ? [{ field, value, sourceField, rawValue: value, quality: 'VERIFIED' as const, fetchedAt }] : [];
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
        quality: 'VERIFIED',
        fetchedAt
      });
    }
  }
  return attributes;
}

export function mapDvsaVehicle(vehicle: DvsaVehicle, fetchedAt = new Date()): ProviderLookupResult {
  const attributes = vehicleAttributes(vehicle, fetchedAt);
  const events: ProviderEvent[] = (vehicle.motTests ?? []).map((test, index) => {
    const odometer = normalizeDvsaOdometer(test.odometerValue, test.odometerUnit);
    const defects = normalizedDefects(test.defects);
    const testResult = clean(test.testResult)?.toUpperCase() ?? null;
    return {
      externalId: testExternalId(test, index),
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
