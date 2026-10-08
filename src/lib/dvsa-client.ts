import { getDvsaAccessToken, loadDvsaConfig, type DvsaConfig } from '@/lib/dvsa-auth';
import { rateLimit } from '@/lib/rate-limit';
import type { DvsaBulkDownloadResponse, DvsaErrorBody, DvsaVehicle } from '@/lib/dvsa-types';

export class DvsaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'DvsaApiError';
  }
}

type FetchLike = typeof fetch;

type ClientOptions = {
  fetchImpl?: FetchLike;
  tokenProvider?: (config: DvsaConfig) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  retries?: number;
};

function parseErrorCode(status: number, body: DvsaErrorBody | null) {
  return body?.errorCode || body?.code || `DVSA_HTTP_${status}`;
}

function retryableStatus(status: number) {
  return status === 429 || status >= 500;
}

async function errorBody(response: Response): Promise<DvsaErrorBody | null> {
  try {
    const parsed = await response.json();
    return parsed && typeof parsed === 'object' ? parsed as DvsaErrorBody : null;
  } catch {
    return null;
  }
}

export function createDvsaClient(options: ClientOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenProvider = options.tokenProvider ?? getDvsaAccessToken;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retries = options.retries ?? 2;

  async function request<T>(path: string): Promise<T | null> {
    const config = loadDvsaConfig();
    const limited = await rateLimit('dvsa-mot:global', 10, 1_000);
    if (!limited.allowed) throw new DvsaApiError(429, 'DVSA_LOCAL_RATE_LIMITED', 'Local DVSA request limit reached', true);

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const token = await tokenProvider(config);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${config.baseUrl}${path}`, {
          headers: {
            accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-API-Key': config.apiKey
          },
          cache: 'no-store',
          signal: controller.signal
        });

        if (response.ok) return await response.json() as T;
        const body = await errorBody(response);
        const code = parseErrorCode(response.status, body);
        if (response.status === 404 && code === 'MOTH-NF-01') return null;

        const retryable = retryableStatus(response.status);
        if (retryable && attempt < retries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1_000
            : 250 * (2 ** attempt);
          await sleep(delay);
          continue;
        }
        throw new DvsaApiError(
          response.status,
          code,
          body?.errorMessage || body?.message || `DVSA request failed with HTTP ${response.status}`,
          retryable
        );
      } catch (error) {
        if (error instanceof DvsaApiError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          if (attempt < retries) {
            await sleep(250 * (2 ** attempt));
            continue;
          }
          throw new DvsaApiError(504, 'DVSA_TIMEOUT', 'DVSA request timed out', true);
        }
        if (attempt < retries) {
          await sleep(250 * (2 ** attempt));
          continue;
        }
        throw new DvsaApiError(503, 'DVSA_NETWORK_ERROR', error instanceof Error ? error.message : 'DVSA network error', true);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new DvsaApiError(503, 'DVSA_RETRY_EXHAUSTED', 'DVSA retry budget exhausted', true);
  }

  return {
    getVehicleByVin(vin: string) {
      return request<DvsaVehicle>(`/v1/trade/vehicles/vin/${encodeURIComponent(vin)}`);
    },
    getVehicleByRegistration(registration: string) {
      return request<DvsaVehicle>(`/v1/trade/vehicles/registration/${encodeURIComponent(registration.trim().toUpperCase())}`);
    },
    getBulkDownloadManifest() {
      return request<DvsaBulkDownloadResponse>('/v1/trade/vehicles/bulk-download');
    }
  };
}

export const dvsaClient = createDvsaClient();
