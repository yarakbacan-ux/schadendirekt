import type { PolicyScope } from '@/lib/license-policy';

export type ContractLike = {
  active: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  reviewedAt: Date | null;
  markets?: unknown;
  capabilities?: unknown;
};

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

export function isContractActive(contract: ContractLike, now = new Date(), scope: PolicyScope = {}): boolean {
  if (!contract.active || !contract.reviewedAt) return false;
  if (contract.validFrom && contract.validFrom > now) return false;
  if (contract.validUntil && contract.validUntil < now) return false;
  if (!matchesScope(contract.markets, scope.market)) return false;
  if (!matchesScope(contract.capabilities, scope.capability)) return false;
  return true;
}

export function hasActiveContract(contracts: readonly ContractLike[], now = new Date(), scope: PolicyScope = {}): boolean {
  return contracts.some((contract) => isContractActive(contract, now, scope));
}
