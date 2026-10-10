import type { PolicyScope } from '@/lib/license-policy';
import { policyScopeAllows } from '@/lib/policy-scope';

export type ContractLike = {
  name?: string | null;
  reference?: string | null;
  active: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  reviewedBy?: string | null;
  reviewedAt: Date | null;
  markets?: unknown;
  capabilities?: unknown;
};

export function isContractReviewed(contract: ContractLike): boolean {
  return Boolean(
    contract.reviewedAt &&
    contract.reviewedBy?.trim() &&
    contract.name?.trim() &&
    contract.reference?.trim()
  );
}

export function isContractActive(contract: ContractLike, now = new Date(), scope: PolicyScope = {}): boolean {
  if (!contract.active || !isContractReviewed(contract)) return false;
  if (contract.validFrom && contract.validFrom > now) return false;
  if (contract.validUntil && contract.validUntil < now) return false;
  if (!policyScopeAllows(contract.markets, scope.market, 'market')) return false;
  if (!policyScopeAllows(contract.capabilities, scope.capability, 'capability')) return false;
  return true;
}

export function hasActiveContract(contracts: readonly ContractLike[], now = new Date(), scope: PolicyScope = {}): boolean {
  return contracts.some((contract) => isContractActive(contract, now, scope));
}
