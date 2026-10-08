export type PolicyScope = {
  market?: string | null;
  capability?: string | null;
};

export type LicenseLike = {
  licenseName?: string | null;
  termsUrl?: string | null;
  notes?: string | null;
  canStore: boolean;
  canRedistribute: boolean;
  canCommercialize: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  retentionDays: number | null;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  markets?: unknown;
  capabilities?: unknown;
};

export type LicenseAction = 'STORE' | 'REDISTRIBUTE' | 'COMMERCIALIZE';

function normalizedScopeValues(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function matchesScope(value: unknown, requested: string | null | undefined): boolean {
  const allowed = normalizedScopeValues(value);
  if (allowed == null || allowed.length === 0) return true;
  const normalized = requested?.trim().toUpperCase() || null;
  if (!normalized) return allowed.includes('*');
  return allowed.includes('*') || allowed.includes(normalized);
}

export function isLicenseReviewed(license: LicenseLike): boolean {
  const reviewer = license.reviewedBy?.trim();
  const documented = Boolean(license.licenseName?.trim() || license.termsUrl?.trim() || license.notes?.trim());
  return Boolean(license.reviewedAt && reviewer && documented);
}

export function isLicenseActive(license: LicenseLike, at = new Date()): boolean {
  if (!isLicenseReviewed(license)) return false;
  if (license.validFrom && license.validFrom > at) return false;
  if (license.validUntil && license.validUntil < at) return false;
  return true;
}

export function permitsLicenseAction(
  license: LicenseLike,
  action: LicenseAction,
  at = new Date(),
  scope: PolicyScope = {}
): boolean {
  if (!isLicenseActive(license, at)) return false;
  if (!matchesScope(license.markets, scope.market)) return false;
  if (!matchesScope(license.capabilities, scope.capability)) return false;
  if (action === 'STORE') return license.canStore;
  if (action === 'REDISTRIBUTE') return license.canRedistribute;
  return license.canRedistribute && license.canCommercialize;
}

export function findLicenseForAction<T extends LicenseLike>(
  licenses: readonly T[],
  action: LicenseAction,
  at = new Date(),
  scope: PolicyScope = {}
): T | null {
  return licenses.find((license) => permitsLicenseAction(license, action, at, scope)) ?? null;
}

export function retentionExpiry(license: LicenseLike, from = new Date()): Date | null {
  if (license.retentionDays == null) return null;
  return new Date(from.getTime() + license.retentionDays * 86_400_000);
}
