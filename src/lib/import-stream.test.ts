import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { streamCsvRecords, streamJsonRecords } from '@/lib/import-stream';

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe('streaming import parsers', () => {
  it('parses RFC-4180 CSV across arbitrary chunk boundaries without loading one text payload', async () => {
    const chunks = [
      'vin,title,description\r\nWBA12345678901234,"Ser',
      'vice, A","line 1\r\nline 2"\r\nWBA12345678901235,"quote ""x',
      '""",ok\r\n'
    ];
    const rows = await collect(streamCsvRecords(Readable.from(chunks)));
    expect(rows).toEqual([
      { vin: 'WBA12345678901234', title: 'Service, A', description: 'line 1\r\nline 2' },
      { vin: 'WBA12345678901235', title: 'quote "x"', description: 'ok' }
    ]);
  });

  it('streams top-level JSON arrays across chunks', async () => {
    const rows = await collect(streamJsonRecords(Readable.from([
      '[{"vin":"WBA12345678901234","title":"A"},',
      '{"vin":"WBA12345678901235","nested":{"x":[1,2,3]}},',
      '{"vin":"WBA12345678901236","title":"B"}]'
    ])));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ vin: 'WBA12345678901235', nested: { x: [1, 2, 3] } });
  });

  it('streams the records array from a JSON object wrapper', async () => {
    const rows = await collect(streamJsonRecords(Readable.from([
      '{"meta":{"source":"fixture"},"rec',
      'ords":[{"vin":"WBA12345678901234"},{"vin":"WBA12345678901235"}],"tail":true}'
    ])));
    expect(rows).toEqual([
      { vin: 'WBA12345678901234' },
      { vin: 'WBA12345678901235' }
    ]);
  });
});
