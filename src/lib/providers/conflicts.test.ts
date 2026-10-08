import { describe, expect, it } from 'vitest';
import { analyzeAttributeConflict } from '@/lib/providers/conflicts';

describe('attribute conflict strategy', () => {
  it('keeps all candidates and selects deterministically without treating newest as truth', () => {
    const result = analyzeAttributeConflict([
      { id: 'new-b', sourceKey: 'source-b', field: 'make', value: 'BMW', quality: 'VERIFIED', fetchedAt: new Date('2026-10-08') },
      { id: 'old-a', sourceKey: 'source-a', field: 'make', value: 'AUDI', quality: 'VERIFIED', fetchedAt: new Date('2025-01-01') }
    ]);
    expect(result.conflict).toBe(true);
    expect(result.selected?.id).toBe('old-a');
    expect(result.candidates).toHaveLength(2);
  });

  it('prefers verified quality over lower quality before source ordering', () => {
    const result = analyzeAttributeConflict([
      { id: 'a', sourceKey: 'a-source', field: 'model', value: 'A', quality: 'UNVERIFIED', fetchedAt: new Date('2026-10-08') },
      { id: 'z', sourceKey: 'z-source', field: 'model', value: 'B', quality: 'VERIFIED', fetchedAt: new Date('2025-01-01') }
    ]);
    expect(result.selected?.id).toBe('z');
  });

  it('does not flag equal normalized values as a conflict', () => {
    const result = analyzeAttributeConflict([
      { id: 'a', sourceKey: 'a', field: 'make', value: 'Mercedes Benz', quality: 'VERIFIED', fetchedAt: new Date() },
      { id: 'b', sourceKey: 'b', field: 'make', value: '  mercedes   benz ', quality: 'VERIFIED', fetchedAt: new Date() }
    ]);
    expect(result.conflict).toBe(false);
  });
});
