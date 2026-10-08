export type DvsaConfig = {
  clientId: string;
  clientSecret: string;
  scope: string;
  tokenUrl: string;
  apiKey: string;
  baseUrl: string;
};

const REQUIRED_ENV = [
  'DVSA_CLIENT_ID',
  'DVSA_CLIENT_SECRET',
  'DVSA_SCOPE_URL',
  'DVSA_TOKEN_URL',
  'DVSA_API_KEY'
] as const;

export function getDvsaConfigurationStatus(env: NodeJS.ProcessEnv = process.env) {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  return { configured: missing.length === 0, missing: [...missing] };
}

export function loadDvsaConfig(env: NodeJS.ProcessEnv = process.env): DvsaConfig {
  const status = getDvsaConfigurationStatus(env);
  if (!status.configured) throw new Error(`DVSA_CREDENTIALS_MISSING:${status.missing.join(',')}`);
  return {
    clientId: env.DVSA_CLIENT_ID!.trim(),
    clientSecret: env.DVSA_CLIENT_SECRET!.trim(),
    scope: env.DVSA_SCOPE_URL!.trim(),
    tokenUrl: env.DVSA_TOKEN_URL!.trim(),
    apiKey: env.DVSA_API_KEY!.trim(),
    baseUrl: (env.DVSA_BASE_URL?.trim() || 'https://history.mot.api.gov.uk').replace(/\/$/, '')
  };
}

type FetchLike = typeof fetch;

type CachedToken = { accessToken: string; expiresAtMs: number; cacheKey: string } | null;

export function createDvsaTokenProvider(options: {
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshSkewMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const refreshSkewMs = options.refreshSkewMs ?? 60_000;
  let cache: CachedToken = null;
  let inflight: Promise<string> | null = null;

  async function requestToken(config: DvsaConfig): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope
    });
    const response = await fetchImpl(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`DVSA_TOKEN_HTTP_${response.status}`);
    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== 'string' || !payload.access_token) throw new Error('DVSA_TOKEN_INVALID_RESPONSE');
    const expiresIn = Number(payload.expires_in);
    const ttlMs = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 20 * 60 * 1000;
    cache = {
      accessToken: payload.access_token,
      expiresAtMs: now() + ttlMs,
      cacheKey: `${config.tokenUrl}|${config.clientId}|${config.scope}`
    };
    return payload.access_token;
  }

  return async function getToken(config: DvsaConfig): Promise<string> {
    const cacheKey = `${config.tokenUrl}|${config.clientId}|${config.scope}`;
    if (cache && cache.cacheKey === cacheKey && cache.expiresAtMs - refreshSkewMs > now()) return cache.accessToken;
    if (!inflight) inflight = requestToken(config).finally(() => { inflight = null; });
    return inflight;
  };
}

export const getDvsaAccessToken = createDvsaTokenProvider();
