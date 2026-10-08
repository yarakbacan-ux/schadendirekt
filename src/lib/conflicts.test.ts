import { describe, expect, it } from 'vitest';
import { analyzeFieldConflicts, compareConflictCandidates } from '@/lib/conflicts';

const at = new Date('2026-10-08T12:00:00Z');

describe('source conflict strategy', () => {
  it('detects differing values without treating the newest source as automatically true', () => {
    const candidates = [
      { id: 'b', field: 'make', value: 'BMW', quality: 'VERIFIED', fetchedAt: new Date('2026-10-08T13:00:00Z'), source: { key: 'source-b', name: 'Source B' } },
      { id: 'a', field: 'make', value: 'AUDI', quality: 'VERIFIED', fetchedAt: at, source: { key: 'source-a', name: 'Source A' } }
    ];
    const conflicts = analyzeFieldConflicts(candidates);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.selectedAttributeId).toBe('a');
    expect(conflicts[0]?.candidates.map((item) => item.value)).toEqual(['AUDI', 'BMW']);
  });

  it('does not flag case/whitespace-only differences as a conflict', () => {
    const conflicts = analyzeFieldConflicts([
      { id: '1', field: 'model', value: 'Golf 8', quality: 'VERIFIED', fetchedAt: at, source: { key: 'a', name: 'A' } },
      { id: '2', field: 'model', value: '  golf   8 ', quality: 'VERIFIED', fetchedAt: at, source: { key: 'b', name: 'B' } }
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('prefers verified over partial before source-key tie breaking', () => {
    const ordered = [
      { id: 'a', field: 'modelYear', value: '2020', quality: 'PARTIAL', fetchedAt: at, source: { key: 'a', name: 'A' } },
      { id: 'b', field: 'modelYear', value: '2021', quality: 'VERIFIED', fetchedAt: at, source: { key: 'b', name: 'B' } }
    ].sort(compareConflictCandidates);
    expect(ordered[0]?.id).toBe('b');
  });
});
