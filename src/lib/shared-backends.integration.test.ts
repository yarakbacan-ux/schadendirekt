import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { S3CompatibleImportStorage } from './import-storage';
import { createRateLimitStoreFromEnv } from './rate-limit';

const describeShared = process.env.RUN_SHARED_BACKEND_SMOKE === '1' ? describe : describe.skip;

describeShared('real isolated shared backend smoke', () => {
  it('shares native Redis counters across independent clients', async () => {
    const key = `shared-smoke:${randomUUID()}`;
    const first = createRateLimitStoreFromEnv();
    const second = createRateLimitStoreFromEnv();
    expect((await first.consume(key, 1, 1000)).allowed).toBe(true);
    expect((await second.consume(key, 1, 1000)).allowed).toBe(false);
  });

  it('roundtrips an actual S3 object, without hiding backend protocol failures', async () => {
    const storage = new S3CompatibleImportStorage({
      endpoint: process.env.IMPORT_STORAGE_S3_ENDPOINT!,
      region: process.env.IMPORT_STORAGE_S3_REGION!,
      bucket: process.env.IMPORT_STORAGE_S3_BUCKET!,
      accessKeyId: process.env.IMPORT_STORAGE_S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.IMPORT_STORAGE_S3_SECRET_ACCESS_KEY!,
      fetchImpl: async (input, init) => {
        const response = await fetch(input, init);
        if (!response.ok && response.status !== 404) {
          const text = await response.clone().text();
          const code = /<Code>([A-Za-z0-9_]+)<\/Code>/.exec(text)?.[1] ?? 'UNKNOWN';
          // Only a backend error code; never include endpoints, headers, keys or XML bodies.
          throw new Error(`S3_${init?.method}_${response.status}_${code}`);
        }
        return response;
      }
    });
    const key = `shared-smoke/${randomUUID()}.txt`;
    try {
      const object = await storage.put(key, 'shared-backend-smoke');
      expect(object.sizeBytes).toBe(Buffer.byteLength('shared-backend-smoke'));
      expect(await storage.readText(key)).toBe('shared-backend-smoke');
      const streamed = await storage.putStream(key, Readable.from([Buffer.alloc(8 * 1024 * 1024, 97), 'tail']));
      expect(streamed.sizeBytes).toBe(8 * 1024 * 1024 + 4);
      const read = await storage.readText(key);
      expect(read.length).toBe(streamed.sizeBytes);
      expect(read.endsWith('tail')).toBe(true);
    } finally {
      await storage.delete(key);
    }
    await expect(storage.readText(key)).rejects.toThrow('IMPORT_OBJECT_NOT_FOUND');
  });
});
