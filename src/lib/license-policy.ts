export type LicenseLike = {
  canStore: boolean;
  canRedistribute: boolean;
  canCommercialize: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  retentionDays: number | null;
};

export type LicenseAction = 'STORE' | 'REDISTRIBUTE' | 'COMMERCIALIZE';

export function isLicenseActive(license: LicenseLike, at = new Date()): boolean {
  if (license.validFrom && license.validFrom > at) return false;
  if (license.validUntil && license.validUntil < at) return false;
  return true;
}

export function permitsLicenseAction(
  license: LicenseLike,
  action: LicenseAction,
  at = new Date()
): boolean {
  if (!isLicenseActive(license, at)) return false;
  if (action === 'STORE') return license.canStore;
  if (action === 'REDISTRIBUTE') return license.canRedistribute;
  return license.canRedistribute && license.canCommercialize;
}

export function findLicenseForAction<T extends LicenseLike>(
  licenses: T[],
  action: LicenseAction,
  at = new Date()
): T | null {
  return licenses.find((license) => permitsLicenseAction(license, action, at)) ?? null;
}

export function retentionExpiry(license: LicenseLike, from = new Date()): Date | null {
  if (license.retentionDays == null) return null;
  return new Date(from.getTime() + license.retentionDays * 86_400_000);
}
