import { PROVIDER_CAPABILITIES, type ProviderCapability } from '@/lib/providers/types';

export type PolicyScopeKind = 'market' | 'capability';

type ParsedPolicyScope =
  | { mode: 'UNRESTRICTED'; values: null }
  | { mode: 'DENY'; values: null }
  | { mode: 'VALUES'; values: ReadonlySet<string> };

const CAPABILITIES = new Set<string>(PROVIDER_CAPABILITIES);

function normalizeToken(value: string, kind: PolicyScopeKind): string | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === '*') return '*';
  if (kind === 'capability') return CAPABILITIES.has(normalized) ? normalized : null;
  // Operational provider markets are country codes. Do not accept aliases or arbitrary strings here.
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function parsePolicyScope(value: unknown, kind: PolicyScopeKind): ParsedPolicyScope {
  if (value == null) return { mode: 'UNRESTRICTED', values: null };
  if (!Array.isArray(value) || value.length === 0) return { mode: 'DENY', values: null };

  const values = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') return { mode: 'DENY', values: null };
    const normalized = normalizeToken(item, kind);
    if (!normalized) return { mode: 'DENY', values: null };
    values.add(normalized);
  }

  if (values.has('*')) return { mode: 'UNRESTRICTED', values: null };
  return values.size > 0 ? { mode: 'VALUES', values } : { mode: 'DENY', values: null };
}

export function policyScopeAllows(value: unknown, requested: string | null | undefined, kind: PolicyScopeKind): boolean {
  const parsed = parsePolicyScope(value, kind);
  if (parsed.mode === 'UNRESTRICTED') return true;
  if (parsed.mode === 'DENY') return false;
  if (!requested) return false;
  const normalized = normalizeToken(requested, kind);
  if (!normalized || normalized === '*') return false;
  return parsed.values.has(normalized);
}

export function isKnownProviderCapability(value: string): value is ProviderCapability {
  return CAPABILITIES.has(value.trim().toUpperCase());
}
