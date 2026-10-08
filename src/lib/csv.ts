import type { ImportRecord } from '@/lib/import-validation';

export function parseCsv(input: string): ImportRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error('CSV_UNTERMINATED_QUOTE');
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length < 2) return [];

  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    return {
      vin: record.vin,
      externalId: record.externalId || undefined,
      eventType: record.eventType,
      eventDate: record.eventDate || undefined,
      country: record.country || undefined,
      mileageKm: record.mileageKm ? Number(record.mileageKm) : undefined,
      title: record.title,
      description: record.description || undefined
    } as ImportRecord;
  });
}
