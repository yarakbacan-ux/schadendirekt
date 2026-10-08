export type ContractLike = {
  active: boolean;
  validFrom: Date | null;
  validUntil: Date | null;
  reviewedAt: Date | null;
};

export function isContractActive(contract: ContractLike, now = new Date()): boolean {
  if (!contract.active || !contract.reviewedAt) return false;
  if (contract.validFrom && contract.validFrom > now) return false;
  if (contract.validUntil && contract.validUntil < now) return false;
  return true;
}

export function hasActiveContract(contracts: readonly ContractLike[], now = new Date()): boolean {
  return contracts.some((contract) => isContractActive(contract, now));
}
