# SCH-7 Browser-Test

Status: Noch nicht in CI integriert und nicht ausgeführt.

Für einen lokalen Test: PostgreSQL-Testdatenbank bereitstellen, `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm install --no-save --package-lock=false @playwright/test@1.56.1`, `npx playwright install chromium`, `npx playwright test --config=playwright.config.cjs`.

Railway: Vier Dienste sind nur staged. Kein Deployment oder geprüfte Test-URL. Vor dem Start sind Kostenfreiheit, persistente Volumes, Redis, S3, Secrets und Migrationen zu klären. Production-Gates aus SCH-6 bleiben aktiv.
