const { randomBytes, createHash, createHmac } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

// These tests create synthetic, non-publishable fixtures ONLY in an isolated local DB.
// Never point this suite at Railway staging or a user's real database.
function fixtureDb() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/schadendirekt_e2e') {
    throw new Error('Browser tests require local isolated database schadendirekt_e2e');
  }
  return new PrismaClient();
}

async function createAdmin(db) {
  const email = `browser-${randomBytes(8).toString('hex')}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  execFileSync(process.execPath, ['scripts/create-admin.mjs', email], {
    env: { ...process.env, ADMIN_BOOTSTRAP_PASSWORD: password }, stdio: 'pipe'
  });
  return { email, password, user: await db.user.findUniqueOrThrow({ where: { email } }) };
}

async function login(page, admin) {
  await page.goto('/admin/login');
  await page.getByLabel('E-Mail', { exact: true }).fill(admin.email);
  await page.getByLabel('Passwort', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL('**/admin');
}

async function csrfHeaders(context) {
  const cookies = await context.cookies();
  return { origin: 'http://127.0.0.1:3000', 'x-csrf-token': cookies.find((c) => c.name === 'sd_csrf').value };
}

async function readS3Object(key) {
  const url = new URL(`${process.env.IMPORT_STORAGE_S3_ENDPOINT}/${process.env.IMPORT_STORAGE_S3_BUCKET}/${key}`);
  const region = process.env.IMPORT_STORAGE_S3_REGION;
  const time = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = time.slice(0, 8);
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  const hmac = (key, text) => createHmac('sha256', key).update(text).digest();
  const payload = sha('');
  const names = 'host;x-amz-content-sha256;x-amz-date';
  const canonical = `GET\n${url.pathname}\n\nhost:${url.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${time}\n\n${names}\n${payload}`;
  const scope = `${date}/${region}/s3/aws4_request`;
  const signing = hmac(hmac(hmac(hmac(`AWS4${process.env.IMPORT_STORAGE_S3_SECRET_ACCESS_KEY}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signing).update(`AWS4-HMAC-SHA256\n${time}\n${scope}\n${sha(canonical)}`).digest('hex');
  return fetch(url, { headers: {
    'x-amz-content-sha256': payload, 'x-amz-date': time,
    authorization: `AWS4-HMAC-SHA256 Credential=${process.env.IMPORT_STORAGE_S3_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names}, Signature=${signature}`
  }, signal: AbortSignal.timeout(10000) });
}

module.exports = { fixtureDb, createAdmin, login, csrfHeaders, readS3Object };
