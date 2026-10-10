import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { queueImportStream } from '@/lib/imports';
import { getImportMaxBytes } from '@/lib/import-storage';
import { requestId, unexpectedApiError } from '@/lib/api-errors';
import { requireRequestRole, verifyCsrf } from '@/lib/auth';

export const runtime = 'nodejs';

function requestBodyStream(request: Request): Readable {
  if (!request.body) throw new Error('EMPTY_IMPORT_BODY');
  const reader = request.body.getReader();
  return Readable.from((async function* () {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  })());
}

function contentLengthTooLarge(request: Request, maxBytes: number): boolean {
  const raw = request.headers.get('content-length');
  if (!raw) return false;
  try {
    const value = BigInt(raw);
    return value < 0n || value > BigInt(maxBytes);
  } catch {
    return true;
  }
}

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

    const maxBytes = getImportMaxBytes();
    if (contentLengthTooLarge(request, maxBytes)) {
      return NextResponse.json({ error: 'IMPORT_TOO_LARGE', maxBytes: String(maxBytes), requestId: id }, { status: 413, headers: { 'x-request-id': id } });
    }

    const job = await queueImportStream(
      sourceKey,
      requestBodyStream(request),
      format,
      request.headers.get('x-file-name') ?? undefined,
      request.headers.get('x-mapping-version') ?? undefined,
      request.headers.get('x-content-sha256') ?? undefined
    );
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        mappingVersion: job.mappingVersion,
        sizeBytes: job.object?.sizeBytes?.toString() ?? null,
        queued: job.status === 'PENDING',
        requestId: id
      },
      { status: 202, headers: { 'x-request-id': id } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IMPORT_QUEUE_FAILED';
    if (message === 'IMPORT_TOO_LARGE') {
      return NextResponse.json({ error: message, requestId: id }, { status: 413, headers: { 'x-request-id': id } });
    }
    if (message === 'INVALID_MAPPING_VERSION' || message === 'EMPTY_IMPORT_BODY' || message === 'CHECKSUM_MISMATCH' || message === 'INVALID_IMPORT_MAX_BYTES') {
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
