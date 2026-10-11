const { test, expect } = require('@playwright/test');

const VIN = 'WBA00000000000000';

test('invalid FIN returns a visible validation error', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Fahrzeug-Identifizierungsnummer' }).fill('INVALID');
  await page.getByRole('button', { name: 'FIN prüfen' }).click();
  await expect(page.getByRole('heading', { name: 'FIN konnte nicht geprüft werden' })).toBeVisible();
});

test('unlicensed VIN shows no data and opens report', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Fahrzeug-Identifizierungsnummer' }).fill(VIN);
  await page.getByRole('button', { name: 'FIN prüfen' }).click();
  await expect(page.getByRole('heading', { name: 'Keine veröffentlichbaren Daten vorhanden' })).toBeVisible();
  await page.getByRole('link', { name: 'Leeren Bericht mit Datenhinweisen öffnen' }).click();
  await expect(page).toHaveURL(new RegExp('/report/' + VIN + '$'));
});
