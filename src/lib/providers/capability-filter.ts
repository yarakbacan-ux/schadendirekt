import { PROVIDER_CAPABILITIES, type ProviderAttribute, type ProviderCapability, type ProviderEvent, type ProviderLookupResult } from '@/lib/providers/types';

const CAPABILITIES = new Set<string>(PROVIDER_CAPABILITIES);

export const ATTRIBUTE_CAPABILITY_BY_FIELD: Readonly<Record<string, ProviderCapability>> = {
  make: 'VEHICLE_SPECS',
  model: 'VEHICLE_SPECS',
  modelYear: 'VEHICLE_SPECS',
  bodyClass: 'VEHICLE_SPECS',
  fuelType: 'VEHICLE_SPECS',
  engineDisplacement: 'VEHICLE_SPECS',
  enginePowerKw: 'VEHICLE_SPECS',
  transmission: 'VEHICLE_SPECS',
  manufacturer: 'VEHICLE_SPECS',
  plantCountry: 'VEHICLE_SPECS',
  vehicleType: 'VEHICLE_SPECS',
  primaryColour: 'VEHICLE_SPECS',
  secondaryColour: 'VEHICLE_SPECS',
  manufactureDate: 'VEHICLE_SPECS',
  market: 'REGISTRATION',
  registration: 'REGISTRATION',
  registrationDate: 'REGISTRATION',
  firstUsedDate: 'REGISTRATION'
};

export function normalizeCapability(value: string | null | undefined): ProviderCapability | null {
  const normalized = value?.trim().toUpperCase();
  return normalized && CAPABILITIES.has(normalized) ? normalized as ProviderCapability : null;
}

export function attributeCapability(attribute: Pick<ProviderAttribute, 'field' | 'capability'>): ProviderCapability | null {
  return normalizeCapability(attribute.capability) ?? ATTRIBUTE_CAPABILITY_BY_FIELD[attribute.field] ?? null;
}

export function eventCapability(event: Pick<ProviderEvent, 'eventType'>): ProviderCapability | null {
  if (event.eventType === 'ODOMETER_READING') return 'ODOMETER';
  if (event.eventType === 'DAMAGE_RECORD') return 'DAMAGE';
  if (event.eventType === 'INSPECTION') return 'INSPECTION';
  if (event.eventType === 'REGISTRATION' || event.eventType === 'IMPORT_EXPORT') return 'REGISTRATION';
  if (event.eventType === 'RECALL') return 'RECALLS';
  return null;
}

function filterRawPayload(event: ProviderEvent, allowed: ReadonlySet<ProviderCapability>): Record<string, unknown> | null {
  if (!event.rawPayload) return null;
  const fieldCapabilities = event.rawPayloadCapabilities;
  if (!fieldCapabilities) return null;
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.rawPayload)) {
    const capability = normalizeCapability(fieldCapabilities[key]);
    if (capability && allowed.has(capability)) filtered[key] = value;
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

function odometerProjection(event: ProviderEvent, allowed: ReadonlySet<ProviderCapability>): ProviderEvent | null {
  if (!allowed.has('ODOMETER') || event.mileageKm == null) return null;
  return {
    externalId: `${event.externalId}:odometer`,
    eventType: 'ODOMETER_READING',
    sourceEventType: event.sourceEventType ? `${event.sourceEventType}_ODOMETER` : 'ODOMETER',
    eventDate: event.eventDate ?? null,
    country: event.country ?? null,
    mileageKm: event.mileageKm,
    title: 'Kilometerstand',
    description: null,
    quality: event.quality,
    rawPayload: filterRawPayload(event, new Set<ProviderCapability>(['ODOMETER'])),
    rawPayloadCapabilities: event.rawPayloadCapabilities
  };
}

export function filterProviderResultByCapabilities(
  result: ProviderLookupResult,
  capabilities: readonly ProviderCapability[]
): ProviderLookupResult {
  const allowed = new Set(capabilities);
  const attributes = result.attributes.filter((attribute) => {
    const capability = attributeCapability(attribute);
    return capability ? allowed.has(capability) : false;
  });
  const events: ProviderEvent[] = [];

  for (const event of result.events) {
    const primaryCapability = eventCapability(event);
    if (primaryCapability && allowed.has(primaryCapability)) {
      const next: ProviderEvent = { ...event, rawPayload: filterRawPayload(event, allowed) };
      if (!allowed.has('ODOMETER')) next.mileageKm = null;
      events.push(next);
      continue;
    }

    // Composite provider records (e.g. an MOT inspection carrying a mileage reading) must not
    // leak the primary capability when only the sub-capability is licensed. Emit a sanitized
    // odometer projection instead of the inspection payload.
    const projection = odometerProjection(event, allowed);
    if (projection) events.push(projection);
  }

  return { ...result, attributes, events };
}
