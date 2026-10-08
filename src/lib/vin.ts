const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidVin(value: string): boolean {
  return VIN_PATTERN.test(normalizeVin(value));
}
