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

export const COVERAGE_STATUSES = ['LIVE', 'PARTIAL', 'PLANNED', 'UNAVAILABLE'] as const;
export const PROVIDER_AUTH_TYPES = ['NONE', 'API_KEY', 'OAUTH2', 'OAUTH2_API_KEY', 'CONTRACT', 'BULK_FILE'] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export type CoverageStatusName = (typeof COVERAGE_STATUSES)[number];
export type ProviderAuthTypeName = (typeof PROVIDER_AUTH_TYPES)[number];
export type ProviderRequirement = 'CREDENTIALS' | 'LICENSE' | 'CONTRACT';

export type ProviderCoverageDefinition = {
  market: string;
  capabilities: readonly ProviderCapability[];
  status: CoverageStatusName;
  earliestDate?: string | null;
  latestDate?: string | null;
  requirements?: readonly ProviderRequirement[];
  qualityNote?: string | null;
  allowUnknownMarket?: boolean;
};

export type ProviderRefreshPolicy = {
  mode: 'LIVE' | 'CACHE';
  maxAgeSeconds: number | null;
};

export type ProviderRateLimit = {
  requestsPerMinute?: number | null;
  requestsPerDay?: number | null;
  note?: string | null;
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
  market: string | null;
};

export type ProviderLookupResult = {
  cached: boolean;
  availability?: 'DATA' | 'NO_DATA';
  mappingVersion?: string;
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
  authType?: ProviderAuthTypeName;
  refreshPolicy?: ProviderRefreshPolicy;
  rateLimit?: ProviderRateLimit;
  mappingVersion?: string;
  coverage?: readonly ProviderCoverageDefinition[];
  configurationStatus?: () => ProviderConfigurationStatus;
  lookup(vin: string, context: ProviderLookupContext): Promise<ProviderLookupResult>;
};

export type ProviderOutcomeStatus = 'SUCCESS' | 'NO_DATA' | 'FAILED' | 'SKIPPED' | 'NOT_APPLICABLE';

export type ProviderOutcome = {
  providerKey: string;
  status: ProviderOutcomeStatus;
  cached: boolean;
  attributes: ProviderAttribute[];
  events: ProviderEvent[];
  errorCode: string | null;
  decisionReason?: string | null;
  market?: string | null;
  mappingVersion?: string | null;
};
