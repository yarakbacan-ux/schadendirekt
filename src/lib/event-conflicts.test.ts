import { describe, expect, it } from 'vitest';
import { analyzeEventConflicts } from '@/lib/event-conflicts';

function event(overrides: Partial<Parameters<typeof analyzeEventConflicts>[0][number]> & { id: string }) {
  return {
    id: overrides.id,
    eventType: overrides.eventType ?? 'OTHER',
    sourceEventType: overrides.sourceEventType ?? null,
    eventDate: overrides.eventDate ?? null,
    country: overrides.country ?? null,
    mileageKm: overrides.mileageKm ?? null
  };
}

describe('event conflict strategy', () => {
  it('marks suspicious mileage pairs but not harmless mileage notices', () => {
    const analysis = analyzeEventConflicts([
      event({ id: 'a', eventType: 'ODOMETER_READING', eventDate: '2025-01-01', mileageKm: 100_000 }),
      event({ id: 'b', eventType: 'INSPECTION', eventDate: '2025-02-01', mileageKm: 90_000 })
    ]);
    expect([...analysis.conflictIds].sort()).toEqual(['a', 'b']);
    expect(analysis.mileageFindings.some((finding) => finding.code === 'BACKWARD_READING')).toBe(true);
  });

  it('marks registration conflicts only for directly comparable same-day semantics', () => {
    const analysis = analyzeEventConflicts([
      event({ id: 'de', eventType: 'REGISTRATION', sourceEventType: 'FIRST_REGISTRATION', eventDate: '2025-01-01', country: 'DE' }),
      event({ id: 'fr', eventType: 'REGISTRATION', sourceEventType: 'FIRST_REGISTRATION', eventDate: '2025-01-01', country: 'FR' }),
      event({ id: 'later', eventType: 'REGISTRATION', sourceEventType: 'FIRST_REGISTRATION', eventDate: '2026-01-01', country: 'FR' })
    ]);
    expect([...analysis.conflictIds].sort()).toEqual(['de', 'fr']);
  });

  it('does not auto-merge or flag damage records by date and VIN alone', () => {
    const analysis = analyzeEventConflicts([
      event({ id: 'damage-a', eventType: 'DAMAGE_RECORD', sourceEventType: 'CLAIM', eventDate: '2025-05-01', country: 'DE' }),
      event({ id: 'damage-b', eventType: 'DAMAGE_RECORD', sourceEventType: 'AUCTION', eventDate: '2025-05-01', country: 'DE' })
    ]);
    expect([...analysis.conflictIds]).toEqual([]);
  });
});
