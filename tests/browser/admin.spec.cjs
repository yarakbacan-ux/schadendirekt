const { test, expect } = require('@playwright/test');
const { createHash } = require('node:crypto');
const { fixtureDb, createAdmin, login, csrfHeaders } = require('./helpers.cjs');
let db, admin;
test.beforeAll(async () => { db = fixtureDb(); admin = await createAdmin(db); });
test.afterAll(async () => {
  if (admin) await db.user.delete({ where: { id: admin.user.id } });
  await db?.$disconnect();
});

test('admin rejects anonymous access and invalid credentials', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel('E-Mail', { exact: true }).fill(admin.email);
  await page.getByLabel('Passwort', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login\?error=credentials$/);
  await expect(page.getByRole('alert').filter({ hasText: 'Anmeldung fehlgeschlagen.' })).toBeVisible();
  expect(await db.session.count({ where: { userId: admin.user.id } })).toBe(0);
});

test('admin login, persistent secure session, CSRF checks and logout', async ({ page, context }) => {
  await login(page, admin);
  await expect(page.getByRole('heading', { name: 'Source Operations & Datenqualität' })).toBeVisible();
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === 'sd_session');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });
  const tokenHash = createHash('sha256').update(cookie.value).digest('hex');
  expect(await db.session.findUnique({ where: { tokenHash } })).not.toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Source Operations & Datenqualität' })).toBeVisible();

  const headers = await csrfHeaders(context);
  for (const rejected of [
    { origin: headers.origin },
    { ...headers, 'x-csrf-token': 'wrong-token' },
    { ...headers, origin: 'https://attacker.example.invalid' }
  ]) {
    const response = await context.request.post('/api/auth/logout', { headers: rejected });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toBe('CSRF_REJECTED');
    expect(await db.session.findUnique({ where: { tokenHash } })).not.toBeNull();
  }
  const response = await context.request.post('/api/auth/logout', { headers });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(await db.session.findUnique({ where: { tokenHash } })).toBeNull();
  expect((await context.cookies()).some((c) => c.name === 'sd_session' || c.name === 'sd_csrf')).toBe(false);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  // A stolen old cookie cannot restore the revoked server-side session.
  const replay = await context.request.post('/api/auth/logout', { headers: { ...headers, cookie: `sd_session=${cookie.value}` } });
  expect(replay.status()).toBe(401);
});
