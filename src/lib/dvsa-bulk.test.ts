import { describe, expect, it } from 'vitest';
import { parseDvsaNdjson, parseDvsaNdjsonStream, shouldDeleteDvsaRecord } from '@/lib/dvsa-bulk';

const ndjson = [
  JSON.stringify({ registration: 'TEST001', modification: 'CREATED', motTests: [] }),
  JSON.stringify({ registration: 'TEST002', last_modification: 'UPDATED', motTests: [] }),
  JSON.stringify({ registration: 'TEST003', last_modification: 'DELETED', motTests: [] })
].join('\n');

describe('DVSA bulk/delta parser', () => {
  it('recognises CREATED, UPDATED and DELETED records', () => {
    const records = parseDvsaNdjson(ndjson);
    expect(records.map((record) => record.modification)).toEqual(['CREATED', 'UPDATED', 'DELETED']);
    expect(shouldDeleteDvsaRecord(records[2]!)).toBe(true);
  });

  it('parses NDJSON incrementally across arbitrary stream chunks', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(ndjson);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 23));
        controller.enqueue(bytes.slice(23, 77));
        controller.enqueue(bytes.slice(77));
        controller.close();
      }
    });
    const records = [];
    for await (const record of parseDvsaNdjsonStream(stream)) records.push(record);
    expect(records).toHaveLength(3);
    expect(records[1]?.vehicle.registration).toBe('TEST002');
  });
});
