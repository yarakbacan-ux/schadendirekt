import { createClient } from 'redis';

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitResult>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    current.count += 1;
    return {
      allowed: current.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }
}

export interface RedisEvalClient {
  eval(script: string, keys: string[], args: string[]): Promise<number[]>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisEvalClient, private readonly prefix = 'schadendirekt:rl:') {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const script = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
      local ttl = redis.call('PTTL', KEYS[1])
      return {count, ttl}
    `;
    const [count, ttl] = await this.redis.eval(script, [`${this.prefix}${key}`], [String(windowMs)]);
    return {
      allowed: count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil(Math.max(ttl, 1) / 1000))
    };
  }
}

export class RedisRestEvalClient implements RedisEvalClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async eval(script: string, keys: string[], args: string[]): Promise<number[]> {
    const response = await this.fetchImpl(this.endpoint.replace(/\/$/, ''), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(['EVAL', script, String(keys.length), ...keys, ...args])
    });
    if (!response.ok) throw new Error(`REDIS_RATE_LIMIT_HTTP_${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (!Array.isArray(payload.result) || payload.result.length < 2 || payload.result.some((value) => typeof value !== 'number')) {
      throw new Error('REDIS_RATE_LIMIT_INVALID_RESPONSE');
    }
    return payload.result as number[];
  }
}

// Native Railway Redis uses RESP/TCP, rather than a Redis REST gateway.
export class RedisTcpEvalClient implements RedisEvalClient {
  private client: ReturnType<typeof createClient> | null = null;
  private connecting: Promise<unknown> | null = null;

  constructor(private readonly url: string) {}

  async eval(script: string, keys: string[], args: string[]): Promise<number[]> {
    if (!this.client) {
      this.client = createClient({
        url: this.url,
        disableOfflineQueue: true,
        socket: { connectTimeout: 3000, reconnectStrategy: false }
      });
      // Redis emits socket errors; callers receive a rejected command instead.
      this.client.on('error', () => undefined);
    }
    if (!this.client.isOpen && !this.connecting) {
      this.connecting = this.client.connect().finally(() => { this.connecting = null; });
    }
    if (this.connecting) await this.connecting;
    const result = await this.client.withCommandOptions({ timeout: 5000 }).eval(script, { keys, arguments: args });
    if (!Array.isArray(result) || result.length !== 2 || result.some((value) => typeof value !== 'number')) {
      throw new Error('REDIS_RATE_LIMIT_INVALID_RESPONSE');
    }
    return result as number[];
  }
}

export type RateLimitStoreHealth = {
  ok: boolean;
  mode: 'memory' | 'redis-rest' | 'redis-tcp' | 'unavailable';
  reason: string | null;
};

export function createRateLimitStoreFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitStore {
  const production = env.NODE_ENV === 'production';
  const configured = env.RATE_LIMIT_STORE?.trim().toLowerCase();
  const mode = configured || (production ? '' : 'memory');

  if (mode === 'memory') {
    if (production) throw new Error('RATE_LIMIT_SHARED_STORE_REQUIRED');
    return new InMemoryRateLimitStore();
  }

  if (mode === 'redis-tcp') {
    const url = env.REDIS_URL?.trim();
    if (!url || !/^rediss?:\/\//.test(url)) throw new Error('RATE_LIMIT_REDIS_CONFIG_MISSING');
    return new RedisRateLimitStore(new RedisTcpEvalClient(url));
  }

  if (mode === 'redis' || mode === 'redis-rest') {
    const endpoint = env.REDIS_REST_URL?.trim();
    const token = env.REDIS_REST_TOKEN?.trim();
    if (!endpoint || !token) throw new Error('RATE_LIMIT_REDIS_CONFIG_MISSING');
    return new RedisRateLimitStore(new RedisRestEvalClient(endpoint, token));
  }

  if (production) throw new Error('RATE_LIMIT_SHARED_STORE_REQUIRED');
  throw new Error('RATE_LIMIT_STORE_UNSUPPORTED');
}

let store: RateLimitStore | null = null;

export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next;
}

export function getRateLimitStore(): RateLimitStore {
  if (!store) store = createRateLimitStoreFromEnv();
  return store;
}

export function getRateLimitStoreHealth(env: NodeJS.ProcessEnv = process.env): RateLimitStoreHealth {
  try {
    const configured = env.RATE_LIMIT_STORE?.trim().toLowerCase();
    createRateLimitStoreFromEnv(env);
    return { ok: true, mode: configured === 'redis-tcp' ? 'redis-tcp' : configured === 'redis' || configured === 'redis-rest' ? 'redis-rest' : 'memory', reason: null };
  } catch (error) {
    return {
      ok: false,
      mode: 'unavailable',
      reason: error instanceof Error ? error.message : 'RATE_LIMIT_STORE_UNAVAILABLE'
    };
  }
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  return getRateLimitStore().consume(key, limit, windowMs);
}
