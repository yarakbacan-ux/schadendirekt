import { NextResponse } from 'next/server';
import { queueImport } from '@/lib/imports';
import { requestId, unexpectedApiError } from '@/lib/api-errors';
import { requireRequestRole, verifyCsrf } from '@/lib/auth';

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const session = await requireRequestRole(request, ['ADMIN', 'ANALYST']);
    if (!session) return NextResponse.json({ error: 'UNAUTHORIZED', requestId: id }, { status: 401, headers: { 'x-request-id': id } });
    if (!verifyCsrf(request, session.csrfTokenHash)) {
      return NextResponse.json({ error: 'CSRF_REJECTED', requestId: id }, { status: 403, headers: { 'x-request-id': id } });
    }

    const sourceKey = request.headers.get('x-source-key');
    if (!sourceKey) return NextResponse.json({ error: 'MISSING_SOURCE_KEY', requestId: id }, { status: 400, headers: { 'x-request-id': id } });

    const contentType = request.headers.get('content-type') || '';
    const format = contentType.includes('application/json') ? 'JSON' : contentType.includes('text/csv') ? 'CSV' : null;
    if (!format) return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE', requestId: id }, { status: 415, headers: { 'x-request-id': id } });

    const raw = await request.text();
    const job = await queueImport(
      sourceKey,
      raw,
      format,
      undefined,
      request.headers.get('x-file-name') ?? undefined,
      request.headers.get('x-mapping-version') ?? undefined
    );
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        mappingVersion: job.mappingVersion,
        queued: job.status === 'PENDING',
        requestId: id
      },
      { status: 202, headers: { 'x-request-id': id } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IMPORT_QUEUE_FAILED';
    if (message === 'INVALID_MAPPING_VERSION') {
      return NextResponse.json({ error: message, requestId: id }, { status: 400, headers: { 'x-request-id': id } });
    }
    if (message.includes('LICENSED') || message.includes('RETENTION')) {
      return NextResponse.json({ error: message, requestId: id }, { status: 403, headers: { 'x-request-id': id } });
    }
    if (message.includes('SOURCE_')) {
      return NextResponse.json({ error: message, requestId: id }, { status: 404, headers: { 'x-request-id': id } });
    }
    return unexpectedApiError(error, id);
  }
}
