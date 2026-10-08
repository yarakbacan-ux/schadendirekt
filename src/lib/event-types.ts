export const VEHICLE_EVENT_TYPES = [
  'ODOMETER_READING',
  'DAMAGE_RECORD',
  'INSPECTION',
  'REGISTRATION',
  'SALE_LISTING',
  'SERVICE',
  'RECALL',
  'IMPORT_EXPORT',
  'OTHER'
] as const;

export type VehicleEventTypeName = (typeof VEHICLE_EVENT_TYPES)[number];

const EXACT = new Set<string>(VEHICLE_EVENT_TYPES);

function canonicalize(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeEventType(value: string): VehicleEventTypeName {
  const normalized = canonicalize(value);
  if (EXACT.has(normalized)) return normalized as VehicleEventTypeName;

  if (/(ODOMETER|MILEAGE|KILOMETER|KM_STAND|KMSTAND|TACHO)/.test(normalized)) return 'ODOMETER_READING';
  if (/(DAMAGE|ACCIDENT|CRASH|COLLISION|SCHADEN|UNFALL)/.test(normalized)) return 'DAMAGE_RECORD';
  if (/(INSPECTION|MOT|TUV|TUEV|HAUPTUNTERSUCHUNG|ABGASUNTERSUCHUNG|TECHNICAL_INSPECTION)/.test(normalized)) return 'INSPECTION';
  if (/(REGISTRATION|REGISTERED|ZULASSUNG|TITLE_ISSUED)/.test(normalized)) return 'REGISTRATION';
  if (/(SALE|AUCTION|LISTING|OFFER|VERKAUF|ANGEBOT)/.test(normalized)) return 'SALE_LISTING';
  if (/(SERVICE|MAINTENANCE|REPAIR|WARTUNG|INSPEKTION|WORKSHOP)/.test(normalized)) return 'SERVICE';
  if (/(RECALL|RUECKRUF|SAFETY_CAMPAIGN)/.test(normalized)) return 'RECALL';
  if (/(IMPORT|EXPORT|CUSTOMS|ZOLL|BORDER)/.test(normalized)) return 'IMPORT_EXPORT';

  return 'OTHER';
}

export function isVehicleEventType(value: string): value is VehicleEventTypeName {
  return EXACT.has(value);
}
