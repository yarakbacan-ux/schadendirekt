import type { DataQuality, VehicleEventType } from '@prisma/client';

export const PROVIDER_CAPABILITIES = [
  'VIN_DECODE',
  'VEHICLE_SPECS',
  'ODOMETER',
  'DAMAGE',
  'INSPECTION',
  'REGISTRATION',
  'RECALLS'
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export type ProviderAttribute = {
  field: string;
  value: string;
  sourceField: string | null;
  rawValue?: string | null;
  quality: DataQuality;
  fetchedAt: Date;
};

export type ProviderEvent = {
  externalId: string;
  eventType: VehicleEventType;
  sourceEventType?: string | null;
  eventDate?: Date | null;
  country?: string | null;
  mileageKm?: number | null;
  title: string;
  description?: string | null;
  quality: DataQuality;
  rawPayload?: Record<string, unknown> | null;
};

export type ProviderLookupContext = {
  canStore: boolean;
  now: Date;
};

export type ProviderLookupResult = {
  cached: boolean;
  attributes: ProviderAttribute[];
  events: ProviderEvent[];
  warnings?: string[];
};

export type ProviderConfigurationStatus = {
  configured: boolean;
  missing: string[];
};

export type VehicleDataProvider = {
  key: string;
  name: string;
  description: string;
  capabilities: readonly ProviderCapability[];
  configurationStatus?: () => ProviderConfigurationStatus;
  lookup(vin: string, context: ProviderLookupContext): Promise<ProviderLookupResult>;
};

export type ProviderOutcome = {
  providerKey: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  cached: boolean;
  attributes: ProviderAttribute[];
  events: ProviderEvent[];
  errorCode: string | null;
};
