import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRateLimitStoreHealth, getRateLimitStore } from '@/lib/rate-limit';
import { getImportStorageHealth } from '@/lib/import-storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const checks = {
    app: { ok: true },
    database: { ok: false },
    schema: { ok: false },
    rateLimit: { ok: false, mode: 'unavailable' },
    objectStorage: { ok: false, provider: 'unavailable', connectivityVerified: false },
    providerConfiguration: { ok: true, note: 'Optional provider credentials are not required for NO_DATA tests.' }
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
    // Do not expose database details or credentials.
  }

  const rateLimitConfig = getRateLimitStoreHealth();
  checks.rateLimit.mode = rateLimitConfig.mode;
  if (rateLimitConfig.ok) {
    try {
      await getRateLimitStore().consume('health:readiness', 1000, 60_000);
      checks.rateLimit.ok = true;
    } catch {
      // Shared rate-limit store is unavailable.
    }
  }

  const storage = getImportStorageHealth();
  checks.objectStorage.provider = storage.provider;
  // Configuration alone is not proof of remote object-store availability.
  checks.objectStorage.ok = storage.ok;
  const ready = checks.database.ok && checks.schema.ok &&
    checks.rateLimit.ok && checks.objectStorage.ok;
  return NextResponse.json(
    { status: ready ? 'configured' : 'not_ready', ready: false, checks,
      note: 'Object-storage connectivity must be verified before staging is declared ready.' },
    { status: 503, headers: { 'cache-control': 'no-store' } }
  );
}
