import { NextResponse } from 'next/server';
import { processPendingImportJobs } from '@/lib/imports';
import { requestId, unexpectedApiError } from '@/lib/api-errors';

export async function POST(request: Request) {
  const id = requestId(request);
  try {
    const expected = process.env.WORKER_TOKEN;
    const supplied = request.headers.get('authorization');
    if (!expected || supplied !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'UNAUTHORIZED', requestId: id }, { status: 401, headers: { 'x-request-id': id } });
    }

    const results = await processPendingImportJobs(2, 250);
    return NextResponse.json(
      { processed: results.map((job) => ({ id: job.id, status: job.status, rowsWritten: job.rowsWritten, rowsFailed: job.rowsFailed })), requestId: id },
      { headers: { 'x-request-id': id } }
    );
  } catch (error) {
    return unexpectedApiError(error, id);
  }
}
