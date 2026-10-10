import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  MemoryImportStorage,
  S3CompatibleImportStorage,
  createImportStorageFromEnv,
  getImportStorageHealth
} from './import-storage';

describe('ImportStorage', () => {
  it('stores, reads, streams and deletes an import object', async () => {
    const storage = new MemoryImportStorage();
    const stored = await storage.put('source/job.json', '[{"vin":"TEST"}]');
    expect(stored.provider).toBe('memory');
    expect(stored.sizeBytes).toBeGreaterThan(0);
    expect(await storage.readText(stored.key)).toContain('TEST');

    let streamed = '';
    for await (const chunk of await storage.openReadStream(stored.key)) streamed += chunk.toString();
    expect(streamed).toContain('TEST');

    await storage.delete(stored.key);
    await expect(storage.readText(stored.key)).rejects.toThrow('IMPORT_OBJECT_NOT_FOUND');
  });

  it('fails production closed without shared object storage', () => {
    expect(() => createImportStorageFromEnv({ NODE_ENV: 'production' })).toThrow('IMPORT_STORAGE_SHARED_BACKEND_REQUIRED');
    expect(getImportStorageHealth({ NODE_ENV: 'production' })).toEqual({
      ok: false,
      provider: 'unavailable',
      reason: 'IMPORT_STORAGE_SHARED_BACKEND_REQUIRED'
    });
  });

  it('selects an S3-compatible production backend without exposing credentials', () => {
    const storage = createImportStorageFromEnv({
      NODE_ENV: 'production',
      IMPORT_STORAGE_DRIVER: 's3',
      IMPORT_STORAGE_S3_ENDPOINT: 'https://objects.example.test',
      IMPORT_STORAGE_S3_REGION: 'auto',
      IMPORT_STORAGE_S3_BUCKET: 'imports',
      IMPORT_STORAGE_S3_ACCESS_KEY_ID: 'key',
      IMPORT_STORAGE_S3_SECRET_ACCESS_KEY: 'secret'
    });
    expect(storage).toBeInstanceOf(S3CompatibleImportStorage);
    expect(storage.provider).toBe('s3');
  });

  it('streams S3-compatible upload/download and deletes partial objects when the size limit is exceeded', async () => {
    const objects = new Map<string, Buffer>();
    const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      const key = url.pathname;
      if (init?.method === 'PUT') {
        const chunks: Buffer[] = [];
        const body = init.body as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        objects.set(key, Buffer.concat(chunks));
        return new Response('', { status: 200 });
      }
      if (init?.method === 'DELETE') {
        objects.delete(key);
        return new Response('', { status: 204 });
      }
      if (init?.method === 'GET') {
        const value = objects.get(key);
        return value ? new Response(value.toString('utf8'), { status: 200 }) : new Response('', { status: 404 });
      }
      return new Response('', { status: 405 });
    };
    const storage = new S3CompatibleImportStorage({
      endpoint: 'https://objects.example.test',
      region: 'auto',
      bucket: 'imports',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      fetchImpl: fetchImpl as typeof fetch
    });

    const stored = await storage.putStream('provider/job.ndjson', Readable.from(['ab', 'cd']), { maxBytes: 4 });
    expect(stored.sizeBytes).toBe(4);
    expect(await storage.readText(stored.key)).toBe('abcd');

    await expect(storage.putStream('provider/too-large.ndjson', Readable.from(['abc', 'de']), { maxBytes: 4 })).rejects.toThrow('IMPORT_TOO_LARGE');
    await expect(storage.readText('provider/too-large.ndjson')).rejects.toThrow('IMPORT_OBJECT_NOT_FOUND');
  });
});
