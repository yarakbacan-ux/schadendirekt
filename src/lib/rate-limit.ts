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

let store: RateLimitStore = new InMemoryRateLimitStore();

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  return store.consume(key, limit, windowMs);
}
