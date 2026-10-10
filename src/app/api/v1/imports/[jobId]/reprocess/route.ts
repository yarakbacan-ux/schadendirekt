import { NextResponse } from 'next/server';
import { requestId, unexpectedApiError } from '@/lib/api-errors';
import { requireRequestRole, verifyCsrf } from '@/lib/auth';
import { reprocessImportJob } from '@/lib/imports';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const id = requestId(request);
  try {
    const session = await requireRequestRole(request, ['ADMIN', 'ANALYST']);
    if (!session) return NextResponse.json({ error: 'UNAUTHORIZED', requestId: id }, { status: 401, headers: { 'x-request-id': id } });
    if (!verifyCsrf(request, session.csrfTokenHash)) {
      return NextResponse.json({ error: 'CSRF_REJECTED', requestId: id }, { status: 403, headers: { 'x-request-id': id } });
    }
    const { jobId } = await context.params;
    const mappingVersion = request.headers.get('x-mapping-version')?.trim();
    if (!mappingVersion) return NextResponse.json({ error: 'MISSING_MAPPING_VERSION', requestId: id }, { status: 400, headers: { 'x-request-id': id } });
    const job = await reprocessImportJob(jobId, mappingVersion);
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      mappingVersion: job.mappingVersion,
      sizeBytes: job.object?.sizeBytes?.toString() ?? null,
      requestId: id
    }, { status: 202, headers: { 'x-request-id': id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'REPROCESS_FAILED';
    if (message === 'INVALID_MAPPING_VERSION' || message === 'REPROCESS_MAPPING_VERSION_UNCHANGED' || message === 'MISSING_MAPPING_VERSION') {
      return NextResponse.json({ error: message, requestId: id }, { status: 400, headers: { 'x-request-id': id } });
    }
    if (message.includes('LICENSED') || message.includes('EXPIRED') || message.includes('DELETED')) {
      return NextResponse.json({ error: message, requestId: id }, { status: 403, headers: { 'x-request-id': id } });
    }
    if (message === 'IMPORT_JOB_OR_PAYLOAD_NOT_FOUND') {
      return NextResponse.json({ error: message, requestId: id }, { status: 404, headers: { 'x-request-id': id } });
    }
    return unexpectedApiError(error, id);
  }
}
