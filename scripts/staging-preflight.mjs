// SCH-7: fail-closed configuration check for the external Railway runtime.
// This script never prints variable values or secrets.
const REQUIRED = [
  'DATABASE_URL',
  'REDIS_URL',
  'IMPORT_STORAGE_S3_ENDPOINT',
  'IMPORT_STORAGE_S3_REGION',
  'IMPORT_STORAGE_S3_BUCKET',
  'IMPORT_STORAGE_S3_ACCESS_KEY_ID',
  'IMPORT_STORAGE_S3_SECRET_ACCESS_KEY'
];

export function checkStagingConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !String(env[name] ?? '').trim());
  const invalid = [];
  if (env.NODE_ENV !== 'production') invalid.push('NODE_ENV');
  if (env.RATE_LIMIT_STORE !== 'redis-tcp') invalid.push('RATE_LIMIT_STORE');
  if (env.IMPORT_STORAGE_DRIVER !== 's3') invalid.push('IMPORT_STORAGE_DRIVER');
  for (const [name, protocols] of [
    ['DATABASE_URL', ['postgres:', 'postgresql:']],
    ['REDIS_URL', ['redis:', 'rediss:']],
    ['IMPORT_STORAGE_S3_ENDPOINT', ['https:', 'http:']]
  ]) {
    if (missing.includes(name)) continue;
    try {
      const url = new URL(env[name]);
      if (!protocols.includes(url.protocol) || !url.hostname) invalid.push(name);
      if (name === 'IMPORT_STORAGE_S3_ENDPOINT' && url.protocol !== 'https:' &&
          !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) invalid.push(name);
    } catch {
      invalid.push(name);
    }
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid: [...new Set(invalid)] };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = checkStagingConfig();
  if (!result.ok) {
    console.error('STAGING_PREFLIGHT_FAILED');
    if (result.missing.length) console.error('Missing variables: ' + result.missing.join(', '));
    if (result.invalid.length) console.error('Invalid configuration: ' + result.invalid.join(', '));
    process.exitCode = 1;
  } else {
    console.log('STAGING_PREFLIGHT_OK');
  }
}
