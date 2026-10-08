import { describe, expect, it } from 'vitest';
import { MemoryImportStorage } from './import-storage';

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
});
