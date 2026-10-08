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
type Sleep = (milliseconds: number) => Promise<void>;
type CachedToken = { accessToken: string; expiresAtMs: number; cacheKey: string } | null;

function positiveInt(value: string | undefined, fallback: number, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (allowZero ? parsed < 0 : parsed <= 0) return fallback;
  return parsed;
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createDvsaTokenProvider(options: {
  fetchImpl?: FetchLike;
  now?: () => number;
  refreshSkewMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  sleep?: Sleep;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const refreshSkewMs = options.refreshSkewMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? positiveInt(process.env.DVSA_TOKEN_TIMEOUT_MS, 10_000);
  const maxRetries = options.maxRetries ?? positiveInt(process.env.DVSA_TOKEN_MAX_RETRIES, 2, true);
  const baseRetryDelayMs = options.baseRetryDelayMs ?? 250;
  const sleep: Sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let cache: CachedToken = null;
  let inflight: Promise<string> | null = null;

  async function fetchTokenResponse(config: DvsaConfig, body: URLSearchParams): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(config.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        cache: 'no-store',
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('DVSA_TOKEN_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestToken(config: DvsaConfig): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scope
    });

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await fetchTokenResponse(config, body);
      } catch (error) {
        const message = error instanceof Error && error.message === 'DVSA_TOKEN_TIMEOUT'
          ? 'DVSA_TOKEN_TIMEOUT'
          : 'DVSA_TOKEN_NETWORK';
        if (attempt < maxRetries) {
          await sleep(Math.min(baseRetryDelayMs * (2 ** attempt), 2_000));
          continue;
        }
        throw new Error(message);
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'), now());
          await sleep(retryAfter ?? Math.min(baseRetryDelayMs * (2 ** attempt), 2_000));
          continue;
        }
        throw new Error(`DVSA_TOKEN_HTTP_${response.status}`);
      }

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

    throw new Error('DVSA_TOKEN_RETRY_EXHAUSTED');
  }

  return async function getToken(config: DvsaConfig): Promise<string> {
    const cacheKey = `${config.tokenUrl}|${config.clientId}|${config.scope}`;
    if (cache && cache.cacheKey === cacheKey && cache.expiresAtMs - refreshSkewMs > now()) return cache.accessToken;
    if (!inflight) inflight = requestToken(config).finally(() => { inflight = null; });
    return inflight;
  };
}

export const getDvsaAccessToken = createDvsaTokenProvider();
