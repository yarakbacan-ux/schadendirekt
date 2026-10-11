const { test, expect } = require('@playwright/test');
const { fixtureDb } = require('./helpers.cjs');

const VIN = 'WBA00000000000000';
let db;
test.beforeAll(async () => {
  db = fixtureDb();
  expect(await db.sourceLicense.count({ where: { canRedistribute: true } })).toBe(0);
  expect(await db.sourceLicense.count({ where: { canCommercialize: true } })).toBe(0);
});
test.afterAll(async () => { await db?.$disconnect(); });

test('invalid FIN returns HTTP 400 and a visible validation error', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fahrzeughistorie transparent prüfen' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Fahrzeug-Identifizierungsnummer' }).fill('INVALID');
  const responsePromise = page.waitForResponse((r) => r.url().includes('/api/v1/vehicles/INVALID'));
  await page.getByRole('button', { name: 'FIN prüfen' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toBe('INVALID_VIN');
  await expect(page.getByRole('heading', { name: 'FIN konnte nicht geprüft werden' })).toBeVisible();
  await page.goto('/report/INVALID');
  await expect(page.getByRole('heading', { name: 'FIN ungültig' })).toBeVisible();
});

test('NO_DATA makes no accident-free claim and opens an empty report', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Fahrzeug-Identifizierungsnummer' }).fill(VIN);
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/v1/vehicles/' + VIN));
  await page.getByRole('button', { name: 'FIN prüfen' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const report = await response.json();
  expect(report.status).toBe('NO_DATA');
  expect(report.timeline).toEqual([]);
  expect(report.disclaimer).toMatch(/nicht.*unfallfrei/);
  await expect(page.getByRole('heading', { name: 'Keine veröffentlichbaren Daten vorhanden' })).toBeVisible();
  await page.getByRole('link', { name: 'Leeren Bericht mit Datenhinweisen öffnen' }).click();
  await expect(page).toHaveURL(new RegExp('/report/' + VIN + '$'));
  await expect(page.getByRole('heading', { name: 'Schadenereignisse' })).toBeVisible();
  await expect(page.getByText('Keine veröffentlichbaren Schadenereignisse vorhanden. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist.')).toBeVisible();
  await expect(page.getByText('Keine veröffentlichbaren Historienereignisse vorhanden.')).toBeVisible();
  // Providers without actual reviewed rights must not be contacted.
  expect(await db.providerRun.count({ where: { status: 'SUCCESS' } })).toBe(0);
});

test('health is ready against migrated PostgreSQL, real Redis and S3', async ({ page }) => {
  for (const path of ['/health', '/api/health']) {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toMatchObject({
      app: { ok: true }, database: { ok: true }, schema: { ok: true },
      rateLimit: { ok: true, mode: 'redis-tcp' },
      objectStorage: { ok: true, provider: 's3', connectivityVerified: true },
      providerConfiguration: { required: false }
    });
    expect(JSON.stringify(body)).not.toContain(process.env.IMPORT_STORAGE_S3_SECRET_ACCESS_KEY);
    expect(JSON.stringify(body)).not.toContain(process.env.WORKER_TOKEN);
  }
});
