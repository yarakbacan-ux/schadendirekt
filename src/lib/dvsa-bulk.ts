import { getDvsaModification, mapDvsaVehicle } from '@/lib/dvsa-mapping';
import type { DvsaVehicle } from '@/lib/dvsa-types';

export type DvsaBulkRecord = {
  lineNumber: number;
  vehicle: DvsaVehicle;
  modification: 'CREATED' | 'UPDATED' | 'DELETED' | 'UNKNOWN';
};

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

export async function* parseDvsaNdjsonStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<DvsaBulkRecord> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let lineNumber = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
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
  } finally {
    reader.releaseLock();
  }
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
