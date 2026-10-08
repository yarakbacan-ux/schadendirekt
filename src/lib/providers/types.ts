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
export type ProviderAuthType = 'NONE' | 'API_KEY' | 'OAUTH2_CLIENT_CREDENTIALS' | 'BASIC' | 'PARTNER' | 'OTHER';
export type ProviderCoverageStatus = 'LIVE' | 'PARTIAL' | 'PLANNED' | 'UNAVAILABLE';

export type ProviderCoverageDefinition = {
  marketCode: string;
  capabilities: readonly ProviderCapability[];
  status: ProviderCoverageStatus;
  earliestDate?: string | null;
  latestDate?: string | null;
  requiresCredentials?: boolean;
  requiresContract?: boolean;
  requiresLicense?: boolean;
  freshnessHours?: number | null;
  qualityNote?: string | null;
  notes?: string | null;
};

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
  authType: ProviderAuthType;
  refreshPolicy: string;
  rateLimitPolicy: string;
  mappingVersion: string;
  coverage: readonly ProviderCoverageDefinition[];
  mapping: Readonly<Record<string, string>>;
  configurationStatus?: () => ProviderConfigurationStatus;
  lookup(vin: string, context: ProviderLookupContext): Promise<ProviderLookupResult>;
};

export type ProviderDecision = 'DATA' | 'NO_DATA' | 'NOT_APPLICABLE' | 'NOT_CONFIGURED' | 'ERROR' | 'SKIPPED';

export type ProviderOutcome = {
  providerKey: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  decision: ProviderDecision;
  decisionReason: string | null;
  mappingVersion: string;
  cached: boolean;
  attributes: ProviderAttribute[];
  events: ProviderEvent[];
  errorCode: string | null;
};
