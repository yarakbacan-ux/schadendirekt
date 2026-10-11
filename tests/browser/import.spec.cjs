const { test, expect } = require('@playwright/test');
const { fixtureDb, createAdmin, login, csrfHeaders, readS3Object } = require('./helpers.cjs');
let db, admin, source;
const VIN = 'WBA00000000000001';
const SOURCE_KEY = 'browser-only-nonpublishable-fixture';
const RAW = JSON.stringify([{ vin: VIN, eventType: 'SERVICE', title: 'AUTOMATED TEST FIXTURE — NOT REAL HISTORY' }]);

test.beforeAll(async () => {
  db = fixtureDb();
  admin = await createAdmin(db);
  source = await db.dataSource.create({ data: { key: SOURCE_KEY, name: 'Automated test fixture, never staging data' } });
  await db.sourceLicense.create({ data: {
    sourceId: source.id, licenseName: 'Synthetic test fixture only',
    canStore: true, canRedistribute: false, canCommercialize: false,
    retentionDays: 1, reviewedAt: new Date(), reviewedBy: 'Automated test fixture'
  } });
});
test.afterAll(async () => {
  if (source) {
    await db.vehicleEvent.deleteMany({ where: { sourceId: source.id } });
    await db.importJob.deleteMany({ where: { sourceId: source.id } });
    await db.sourceLicense.deleteMany({ where: { sourceId: source.id } });
    await db.dataSource.delete({ where: { id: source.id } });
    await db.vehicle.deleteMany({ where: { vin: VIN } });
  }
  if (admin) await db.user.delete({ where: { id: admin.user.id } });
  await db?.$disconnect();
});

test('authenticated import → PENDING → worker → S3 retention and audit', async ({ page, context }) => {
  const anonymous = await context.request.post('/api/v1/imports', { data: RAW });
  expect(anonymous.status()).toBe(401);
  await login(page, admin);
  const headers = { ...(await csrfHeaders(context)), 'content-type': 'application/json', 'x-source-key': SOURCE_KEY, 'x-file-name': 'browser-fixture.json' };
  const rejected = await context.request.post('/api/v1/imports', { data: RAW, headers: { ...headers, 'x-csrf-token': 'wrong' } });
  expect(rejected.status()).toBe(403);
  const queued = await context.request.post('/api/v1/imports', { data: RAW, headers });
  expect(queued.status()).toBe(202);
  const body = await queued.json();
  expect(body.status).toBe('PENDING');
  expect(body.queued).toBe(true);
  expect(body.sizeBytes).toBe(String(Buffer.byteLength(RAW)));
  const job = await db.importJob.findUniqueOrThrow({ where: { id: body.jobId }, include: { object: true } });
  expect(job.object.provider).toBe('s3');
  expect(job.object.storageKey).toMatch(new RegExp('^' + SOURCE_KEY + '/'));
  expect(typeof job.object.sizeBytes).toBe('bigint');
  expect(job.object.sizeBytes).toBe(BigInt(Buffer.byteLength(RAW)));
  expect(job.object.expiresAt.getTime()).toBeGreaterThan(Date.now());
  const stored = await readS3Object(job.object.storageKey);
  expect(stored.status).toBe(200);
  expect(await stored.text()).toBe(RAW);

  const workerDenied = await context.request.post('/api/internal/import-worker');
  expect(workerDenied.status()).toBe(401);
  const workerHeaders = { authorization: `Bearer ${process.env.WORKER_TOKEN}` };
  const worked = await context.request.post('/api/internal/import-worker', { headers: workerHeaders });
  expect(worked.status()).toBe(200);
  expect((await worked.json()).processed).toContainEqual(expect.objectContaining({
    id: job.id, status: 'COMPLETED', rowsRead: 1, rowsWritten: 1, rowsFailed: 0
  }));
  expect((await db.importJob.findUniqueOrThrow({ where: { id: job.id } })).finishedAt).not.toBeNull();
  expect(await db.vehicleEvent.count({ where: { sourceId: source.id } })).toBe(1);
  // The synthetic event is never published by the real application.
  const report = await context.request.get('/api/v1/vehicles/' + VIN);
  expect(report.status()).toBe(200);
  expect((await report.json()).timeline).toEqual([]);

  await db.importObject.update({ where: { id: job.object.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await db.vehicleEvent.updateMany({ where: { sourceId: source.id }, data: { rawPayloadExpiresAt: new Date(Date.now() - 1000) } });
  const cleanup = await context.request.post('/api/internal/import-worker', { headers: workerHeaders });
  expect(cleanup.status()).toBe(200);
  expect((await db.importObject.findUniqueOrThrow({ where: { id: job.object.id } })).deletedAt).not.toBeNull();
  expect(await db.importAuditLog.findFirst({ where: { importJobId: job.id, action: 'DELETE_RETENTION' } })).not.toBeNull();
  expect((await db.vehicleEvent.findFirstOrThrow({ where: { sourceId: source.id } })).rawPayload).toBeNull();
  expect((await readS3Object(job.object.storageKey)).status).toBe(404);
});
