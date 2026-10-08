import { describe, expect, it } from 'vitest';
import { isValidVin, normalizeVin } from './vin';

describe('VIN validation', () => {
  it('normalizes lowercase input', () => {
    expect(normalizeVin(' wba12345678901234 ')).toBe('WBA12345678901234');
  });

  it('accepts a 17-character VIN without I, O or Q', () => {
    expect(isValidVin('WBA12345678901234')).toBe(true);
  });

  it('rejects invalid length', () => {
    expect(isValidVin('WBA123')).toBe(false);
  });

  it('rejects forbidden letters', () => {
    expect(isValidVin('WBA1234567890123I')).toBe(false);
  });
});
