export type ConflictCandidate = {
  id: string;
  field: string;
  value: string;
  quality: string;
  fetchedAt: Date;
  source: { key: string; name: string };
};

const QUALITY_RANK: Record<string, number> = {
  VERIFIED: 0,
  PARTIAL: 1,
  UNVERIFIED: 2,
  CONFLICTING: 3,
  INCOMPLETE: 4,
  STALE: 5,
  REJECTED: 99
};

export function normalizeConflictValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}

export function compareConflictCandidates(a: ConflictCandidate, b: ConflictCandidate): number {
  const quality = (QUALITY_RANK[a.quality] ?? 50) - (QUALITY_RANK[b.quality] ?? 50);
  if (quality !== 0) return quality;
  const source = a.source.key.localeCompare(b.source.key);
  if (source !== 0) return source;
  const id = a.id.localeCompare(b.id);
  if (id !== 0) return id;
  return a.fetchedAt.getTime() - b.fetchedAt.getTime();
}

export function analyzeFieldConflicts(candidates: ConflictCandidate[]) {
  const grouped = new Map<string, ConflictCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.quality === 'REJECTED') continue;
    const list = grouped.get(candidate.field) ?? [];
    list.push(candidate);
    grouped.set(candidate.field, list);
  }

  return [...grouped.entries()].flatMap(([field, values]) => {
    const byValue = new Map<string, ConflictCandidate[]>();
    for (const candidate of values) {
      const normalized = normalizeConflictValue(candidate.value);
      const list = byValue.get(normalized) ?? [];
      list.push(candidate);
      byValue.set(normalized, list);
    }
    if (byValue.size <= 1) return [];
    const ordered = [...values].sort(compareConflictCandidates);
    return [{
      field,
      selectedAttributeId: ordered[0]?.id ?? null,
      candidates: ordered.map((candidate) => ({
        attributeId: candidate.id,
        value: candidate.value,
        quality: candidate.quality,
        source: candidate.source,
        fetchedAt: candidate.fetchedAt.toISOString()
      }))
    }];
  });
}
