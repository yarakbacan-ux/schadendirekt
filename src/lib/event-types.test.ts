import { describe, expect, it } from 'vitest';
import { normalizeEventType } from '@/lib/event-types';

describe('normalizeEventType', () => {
  it('preserves canonical internal event types', () => {
    expect(normalizeEventType('ODOMETER_READING')).toBe('ODOMETER_READING');
    expect(normalizeEventType('DAMAGE_RECORD')).toBe('DAMAGE_RECORD');
  });

  it('maps common source labels without losing the original source value elsewhere', () => {
    expect(normalizeEventType('Kilometerstand')).toBe('ODOMETER_READING');
    expect(normalizeEventType('Accident / collision')).toBe('DAMAGE_RECORD');
    expect(normalizeEventType('TÜV')).toBe('INSPECTION');
    expect(normalizeEventType('auction listing')).toBe('SALE_LISTING');
    expect(normalizeEventType('customs export')).toBe('IMPORT_EXPORT');
  });

  it('falls back to OTHER for unknown labels', () => {
    expect(normalizeEventType('proprietary-source-event-4711')).toBe('OTHER');
  });
});
