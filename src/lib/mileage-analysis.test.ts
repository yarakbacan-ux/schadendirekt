import { describe, expect, it } from 'vitest';
import { analyzeMileage } from '@/lib/mileage-analysis';

describe('analyzeMileage', () => {
  it('returns insufficient data for fewer than two usable readings', () => {
    expect(analyzeMileage([{ id: 'a', eventDate: '2025-01-01', mileageKm: 12_000 }]).status).toBe('INSUFFICIENT_DATA');
  });

  it('detects backward mileage as suspicious and references both events', () => {
    const result = analyzeMileage([
      { id: 'a', eventDate: '2025-01-01', mileageKm: 80_000 },
      { id: 'b', eventDate: '2025-06-01', mileageKm: 65_000 }
    ]);
    expect(result.status).toBe('SUSPICIOUS');
    expect(result.findings[0]).toMatchObject({ code: 'BACKWARD_READING', eventIds: ['a', 'b'] });
  });

  it('marks a long unchanged reading and extreme jump as notices', () => {
    const staticResult = analyzeMileage([
      { id: 'a', eventDate: '2023-01-01', mileageKm: 20_000 },
      { id: 'b', eventDate: '2024-06-01', mileageKm: 20_000 }
    ]);
    expect(staticResult.status).toBe('NOTICE');
    expect(staticResult.findings.some((finding) => finding.code === 'STATIC_LONG_PERIOD')).toBe(true);

    const jumpResult = analyzeMileage([
      { id: 'c', eventDate: '2025-01-01', mileageKm: 10_000 },
      { id: 'd', eventDate: '2025-03-01', mileageKm: 150_000 }
    ]);
    expect(jumpResult.status).toBe('NOTICE');
    expect(jumpResult.findings.some((finding) => finding.code === 'EXTREME_JUMP')).toBe(true);
  });

  it('returns OK for a plausible chronological progression', () => {
    const result = analyzeMileage([
      { id: 'a', eventDate: '2024-01-01', mileageKm: 10_000 },
      { id: 'b', eventDate: '2025-01-01', mileageKm: 24_000 },
      { id: 'c', eventDate: '2026-01-01', mileageKm: 39_000 }
    ]);
    expect(result.status).toBe('OK');
    expect(result.findings).toHaveLength(0);
  });
});
