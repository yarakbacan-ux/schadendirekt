import { NextResponse } from 'next/server';
import { checksumPayload, importRecords, parseCsv, type ImportRecord } from '@/lib/imports';

function isAuthorized(request: Request): boolean {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return false;
  const decoded = atob(auth.slice(6));
  const separator = decoded.indexOf(':');
  return (
    decoded.slice(0, separator) === process.env.ADMIN_EMAIL &&
    decoded.slice(separator + 1) === process.env.ADMIN_PASSWORD
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
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
