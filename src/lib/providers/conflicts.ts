export type ConflictCandidate = {
  id: string;
  sourceKey: string;
  field: string;
  value: string;
  quality: string;
  fetchedAt: Date;
};

const QUALITY_RANK: Record<string, number> = {
  VERIFIED: 0,
  TECHNICALLY_VALID: 1,
  PARTIAL: 2,
  INCOMPLETE: 3,
  STALE: 4,
  UNVERIFIED: 5,
  CONFLICTING: 6,
  REJECTED: 99
};

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function compareConflictCandidates(a: ConflictCandidate, b: ConflictCandidate) {
  const quality = (QUALITY_RANK[a.quality] ?? 50) - (QUALITY_RANK[b.quality] ?? 50);
  if (quality !== 0) return quality;
  const source = a.sourceKey.localeCompare(b.sourceKey);
  if (source !== 0) return source;
  const time = b.fetchedAt.getTime() - a.fetchedAt.getTime();
  if (time !== 0) return time;
  return a.id.localeCompare(b.id);
}

export function analyzeAttributeConflict(candidates: ConflictCandidate[]) {
  const usable = candidates.filter((candidate) => candidate.quality !== 'REJECTED');
  const distinctValues = [...new Set(usable.map((candidate) => normalizeValue(candidate.value)))];
  const sorted = [...usable].sort(compareConflictCandidates);
  return {
    conflict: distinctValues.length > 1,
    distinctValues,
    selected: sorted[0] ?? null,
    candidates: sorted
  };
}

export function groupAttributeConflicts(candidates: ConflictCandidate[]) {
  const grouped = new Map<string, ConflictCandidate[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.field) ?? [];
    list.push(candidate);
    grouped.set(candidate.field, list);
  }
  return [...grouped.entries()].map(([field, values]) => ({ field, ...analyzeAttributeConflict(values) }));
}
