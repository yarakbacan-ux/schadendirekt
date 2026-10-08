import { getDvsaModification, mapDvsaVehicle } from '@/lib/dvsa-mapping';
import type { DvsaVehicle } from '@/lib/dvsa-types';

export type DvsaBulkRecord = {
  lineNumber: number;
  vehicle: DvsaVehicle;
  modification: 'CREATED' | 'UPDATED' | 'DELETED' | 'UNKNOWN';
};

type DvsaChunk = Uint8Array | string;

function parseLine(line: string, lineNumber: number): DvsaBulkRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as DvsaVehicle;
  if (!parsed || typeof parsed !== 'object') throw new Error(`DVSA_BULK_INVALID_RECORD:${lineNumber}`);
  return { lineNumber, vehicle: parsed, modification: getDvsaModification(parsed) };
}

export function parseDvsaNdjson(text: string): DvsaBulkRecord[] {
  const records: DvsaBulkRecord[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseLine(lines[index]!, index + 1);
    if (record) records.push(record);
  }
  return records;
}

export async function* parseDvsaNdjsonChunks(chunks: AsyncIterable<DvsaChunk>): AsyncGenerator<DvsaBulkRecord> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lineNumber = 0;

  for await (const chunk of chunks) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      lineNumber += 1;
      const record = parseLine(line, lineNumber);
      if (record) yield record;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    lineNumber += 1;
    const record = parseLine(buffer.replace(/\r$/, ''), lineNumber);
    if (record) yield record;
  }
}

export async function* parseDvsaNdjsonStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<DvsaBulkRecord> {
  const reader = stream.getReader();
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  yield* parseDvsaNdjsonChunks(chunks());
}

export function mapDvsaBulkRecord(record: DvsaBulkRecord) {
  return {
    modification: record.modification,
    registration: record.vehicle.registration ?? null,
    mapped: mapDvsaVehicle(record.vehicle)
  };
}

export function shouldDeleteDvsaRecord(record: DvsaBulkRecord): boolean {
  return record.modification === 'DELETED';
}
