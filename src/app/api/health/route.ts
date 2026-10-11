import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRateLimitStoreHealth, getRateLimitStore } from '@/lib/rate-limit';
import { getImportStorageHealth, getImportStorage } from '@/lib/import-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Check = { ok: boolean; mode?: string; provider?: string; connectivityVerified?: boolean };
type Readiness = {
  status: 'ready' | 'not_ready';
  ready: boolean;
  checks: {
    app: Check;
    database: Check;
    schema: Check;
    rateLimit: Check;
    objectStorage: Check;
    providerConfiguration: Check;
  };
};

// Cache the remote probe to prevent each health poll from creating S3 objects.
// Share concurrent requests in a single process; the probe remains fail-closed.
let cached: { expires: number; result: Readiness } | null = null;
let inFlight: Promise<Readiness> | null = null;

async function checkReadiness(): Promise<Readiness> {
  const checks: Readiness['checks'] = {
    app: { ok: true },
    database: { ok: false },
    schema: { ok: false },
    rateLimit: { ok: false },
    objectStorage: { ok: false, connectivityVerified: false },
    // Public NO_DATA flow must work without inventing provider rights.
    providerConfiguration: { ok: true }
  };

  try {
    await db.$queryRaw`SELECT 1`;
    checks.database.ok = true;
    const tables = await db.$queryRaw<Array<{ user_table: string | null; migrations_table: string | null }>>`
      SELECT to_regclass('public."User"')::text AS user_table,
             to_regclass('public."_prisma_migrations"')::text AS migrations_table
    `;
    checks.schema.ok = Boolean(tables[0]?.user_table && tables[0]?.migrations_table);
  } catch {
    // Do not expose connection details.
  }

  const rateLimitConfig = getRateLimitStoreHealth();
  checks.rateLimit.mode = rateLimitConfig.mode;
  if (rateLimitConfig.ok) {
    try {
      await getRateLimitStore().consume('health:readiness', 1000, 60_000);
      checks.rateLimit.ok = true;
    } catch {
      // Unavailable shared store fails readiness.
    }
  }

  const storageConfig = getImportStorageHealth();
  checks.objectStorage.provider = storageConfig.provider;
  if (storageConfig.ok) {
    const storage = getImportStorage();
    const key = `health/readiness/${randomUUID()}.txt`;
    const marker = randomUUID();
    try {
      await storage.put(key, marker, { maxBytes: 128 });
      const stored = await storage.readText(key);
      checks.objectStorage.ok = stored === marker;
      checks.objectStorage.connectivityVerified = checks.objectStorage.ok;
    } catch {
      // Configuration alone is never treated as connectivity.
    } finally {
      try {
        await storage.delete(key);
      } catch {
        // Failed cleanup also fails readiness.
        checks.objectStorage.ok = false;
        checks.objectStorage.connectivityVerified = false;
      }
    }
  }

  const ready = Object.values(checks).every((check) => check.ok);
  return { status: ready ? 'ready' : 'not_ready', ready, checks };
}

export async function GET() {
  const now = Date.now();
  if (!cached || cached.expires <= now) {
    if (!inFlight) {
      inFlight = checkReadiness()
        .then((result) => {
          cached = { result, expires: Date.now() + 60_000 };
          return result;
        })
        .finally(() => { inFlight = null; });
    }
    try {
      await inFlight;
    } catch {
      // Unexpected probe failure remains unavailable, without leaking secrets.
      return NextResponse.json({ status: 'not_ready', ready: false }, {
        status: 503, headers: { 'cache-control': 'no-store' }
      });
    }
  }

  const result = cached!.result;
  return NextResponse.json(result, {
    status: result.ready ? 200 : 503,
    headers: { 'cache-control': 'no-store' }
  });
}
