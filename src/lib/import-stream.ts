import type { ImportFormat } from '@/lib/imports';

type StreamChunk = Uint8Array | string;

async function* decodedChunks(stream: AsyncIterable<StreamChunk>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      yield chunk;
    } else {
      const decoded = decoder.decode(chunk, { stream: true });
      if (decoded) yield decoded;
    }
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

function recordFromCsv(headers: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => { record[header] = row[index] ?? ''; });
  return record;
}

export async function* streamCsvRecords(stream: AsyncIterable<StreamChunk>): AsyncGenerator<Record<string, string>> {
  let headers: string[] | null = null;
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false;
  let skipLfAfterCr = false;
  let fieldStarted = false;

  const finishField = () => {
    row.push(field);
    field = '';
    fieldStarted = false;
  };
  const finishRow = () => {
    finishField();
    const completed = row;
    row = [];
    return completed;
  };

  for await (const chunk of decodedChunks(stream)) {
    for (let index = 0; index < chunk.length; index += 1) {
      let char = chunk[index];
      if (skipLfAfterCr) {
        skipLfAfterCr = false;
        if (char === '\n') continue;
      }

      if (inQuotes) {
        if (quotePending) {
          if (char === '"') {
            field += '"';
            quotePending = false;
            continue;
          }
          inQuotes = false;
          quotePending = false;
          // The current character belongs to the unquoted delimiter/newline state.
        } else if (char === '"') {
          quotePending = true;
          continue;
        } else {
          field += char;
          fieldStarted = true;
          continue;
        }
      }

      if (char === '"' && !fieldStarted && field.length === 0) {
        inQuotes = true;
        fieldStarted = true;
        continue;
      }
      if (char === ',') {
        finishField();
        continue;
      }
      if (char === '\r' || char === '\n') {
        if (char === '\r') skipLfAfterCr = true;
        const completed = finishRow();
        if (completed.length === 1 && completed[0] === '') continue;
        if (!headers) {
          headers = completed.map((value, headerIndex) => headerIndex === 0 ? value.replace(/^\uFEFF/, '') : value);
        } else {
          yield recordFromCsv(headers, completed);
        }
        continue;
      }
      field += char;
      fieldStarted = true;
    }
  }

  if (quotePending) {
    quotePending = false;
    inQuotes = false;
  }
  if (inQuotes) throw new Error('INVALID_CSV_UNCLOSED_QUOTE');
  if (field.length > 0 || row.length > 0 || fieldStarted) {
    const completed = finishRow();
    if (!headers) headers = completed.map((value, headerIndex) => headerIndex === 0 ? value.replace(/^\uFEFF/, '') : value);
    else yield recordFromCsv(headers, completed);
  }
}

async function* jsonArrayItems(stream: AsyncIterable<StreamChunk>): AsyncGenerator<unknown> {
  let foundArray = false;
  let seek = '';
  let item = '';
  let itemStarted = false;
  let nestedDepth = 0;
  let inString = false;
  let escape = false;

  const emitItem = () => {
    const trimmed = item.trim();
    item = '';
    itemStarted = false;
    nestedDepth = 0;
    if (!trimmed) return undefined;
    return JSON.parse(trimmed) as unknown;
  };

  for await (const decoded of decodedChunks(stream)) {
    let start = 0;
    if (!foundArray) {
      seek += decoded;
      const first = seek.search(/\S/);
      let arrayIndex = -1;
      if (first >= 0 && seek[first] === '[') arrayIndex = first;
      if (arrayIndex < 0) {
        const match = /"records"\s*:\s*\[/.exec(seek);
        if (match) arrayIndex = match.index + match[0].lastIndexOf('[');
      }
      if (arrayIndex < 0) {
        if (seek.length > 1024) seek = seek.slice(-512);
        continue;
      }
      foundArray = true;
      const remainder = seek.slice(arrayIndex + 1);
      seek = '';
      start = decoded.length - remainder.length;
      // Use the remainder rather than decoded because the array marker can span chunks.
      for (const char of remainder) {
        if (!itemStarted) {
          if (/\s/.test(char) || char === ',') continue;
          if (char === ']') return;
          itemStarted = true;
        }
        if (!inString && nestedDepth === 0 && (char === ',' || char === ']')) {
          const value = emitItem();
          if (value !== undefined) yield value;
          if (char === ']') return;
          continue;
        }
        item += char;
        if (inString) {
          if (escape) escape = false;
          else if (char === '\\') escape = true;
          else if (char === '"') inString = false;
          continue;
        }
        if (char === '"') inString = true;
        else if (char === '{' || char === '[') nestedDepth += 1;
        else if (char === '}' || char === ']') nestedDepth -= 1;
      }
      continue;
    }

    for (let index = start; index < decoded.length; index += 1) {
      const char = decoded[index];
      if (!itemStarted) {
        if (/\s/.test(char) || char === ',') continue;
        if (char === ']') return;
        itemStarted = true;
      }
      if (!inString && nestedDepth === 0 && (char === ',' || char === ']')) {
        const value = emitItem();
        if (value !== undefined) yield value;
        if (char === ']') return;
        continue;
      }
      item += char;
      if (inString) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{' || char === '[') nestedDepth += 1;
      else if (char === '}' || char === ']') nestedDepth -= 1;
    }
  }

  if (!foundArray) throw new Error('INVALID_IMPORT_PAYLOAD');
  if (inString || nestedDepth !== 0) throw new Error('INVALID_JSON_STREAM');
  const value = emitItem();
  if (value !== undefined) yield value;
}

export async function* streamJsonRecords(stream: AsyncIterable<StreamChunk>): AsyncGenerator<unknown> {
  yield* jsonArrayItems(stream);
}

export async function* streamImportRecords(stream: AsyncIterable<StreamChunk>, format: ImportFormat): AsyncGenerator<unknown> {
  if (format === 'CSV') yield* streamCsvRecords(stream);
  else yield* streamJsonRecords(stream);
}
