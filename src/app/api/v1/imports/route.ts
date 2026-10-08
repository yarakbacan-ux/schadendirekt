import { NextResponse } from 'next/server';
import { hasValidAdminCredentials } from '@/lib/basic-auth';
import { checksumPayload, importRecords, parseCsv, type ImportRecord } from '@/lib/imports';

export async function POST(request: Request) {
  if (!hasValidAdminCredentials(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const sourceKey = request.headers.get('x-source-key');
  if (!sourceKey) {
    return NextResponse.json({ error: 'MISSING_SOURCE_KEY' }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') || '';
  const raw = await request.text();
  const checksum = checksumPayload(raw);

  try {
    let format: 'JSON' | 'CSV';
    let records: ImportRecord[];

    if (contentType.includes('application/json')) {
      format = 'JSON';
      const parsed = JSON.parse(raw);
      records = Array.isArray(parsed) ? parsed : parsed.records;
    } else if (contentType.includes('text/csv')) {
      format = 'CSV';
      records = parseCsv(raw);
    } else {
      return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
    }

    if (!Array.isArray(records)) {
      return NextResponse.json({ error: 'INVALID_IMPORT_PAYLOAD' }, { status: 400 });
    }

    const job = await importRecords(sourceKey, records, format, checksum);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
    const status = message.includes('LICENSED') ? 403 : message.includes('SOURCE_') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
