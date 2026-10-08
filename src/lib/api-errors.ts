import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export function requestId(request: Request): string {
  return request.headers.get('x-request-id') || randomUUID();
}

export function unexpectedApiError(error: unknown, id: string, status = 500) {
  console.error(JSON.stringify({
    level: 'error',
    requestId: id,
    message: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    stack: error instanceof Error ? error.stack : undefined
  }));

  return NextResponse.json(
    { error: 'INTERNAL_ERROR', message: 'Die Anfrage konnte nicht verarbeitet werden.', requestId: id },
    { status, headers: { 'x-request-id': id } }
  );
}
