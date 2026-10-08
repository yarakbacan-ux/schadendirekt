import { NextResponse } from 'next/server';
import { isValidVin, normalizeVin } from '@/lib/vin';
import { requestId, unexpectedApiError } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { getVehicleReport } from '@/lib/report';
import { getClientIp } from '@/lib/client-ip';

export async function GET(request: Request, context: { params: Promise<{ vin: string }> }) {
  const id = requestId(request);
  const clientKey = getClientIp(request.headers);
  const limited = await rateLimit(`vin:${clientKey}`, 120, 60_000);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', requestId: id },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSeconds), 'x-request-id': id } }
    );
  }

  try {
    const { vin: rawVin } = await context.params;
    const vin = normalizeVin(rawVin);
    if (!isValidVin(vin)) {
      return NextResponse.json(
        { error: 'INVALID_VIN', message: 'Die FIN muss 17 gültige Zeichen enthalten.', requestId: id },
        { status: 400, headers: { 'x-request-id': id } }
      );
    }

    const report = await getVehicleReport(vin, { hydrateNhtsa: true });
    return NextResponse.json(
      { ...report, requestId: id },
      { headers: { 'x-request-id': id, 'cache-control': 'private, max-age=60' } }
    );
  } catch (error) {
    return unexpectedApiError(error, id, 503);
  }
}
