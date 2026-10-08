import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isValidVin, normalizeVin } from '@/lib/vin';
import { findLicenseForAction } from '@/lib/license-policy';
import { requestId, unexpectedApiError } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';

export async function GET(request: Request, context: { params: Promise<{ vin: string }> }) {
  const id = requestId(request);
  const clientKey = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const limited = rateLimit(`vin:${clientKey}`, 120, 60_000);
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

    const vehicle = await db.vehicle.findUnique({
      where: { vin },
      include: {
        events: {
          include: { source: { include: { licenses: true } } },
          orderBy: [{ eventDate: 'desc' }, { importedAt: 'desc' }]
        }
      }
    });

    if (!vehicle) {
      return NextResponse.json(
        { vin, found: false, status: 'NO_DATA', events: [], requestId: id },
        { headers: { 'x-request-id': id } }
      );
    }

    const now = new Date();
    const publishable = vehicle.events.filter((event) =>
      Boolean(findLicenseForAction(event.source.licenses, 'COMMERCIALIZE', now))
    );

    return NextResponse.json(
      {
        vin,
        found: true,
        status: publishable.length > 0 ? 'DATA_AVAILABLE' : 'NO_DATA',
        disclaimer: publishable.length === 0
          ? 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist.'
          : undefined,
        events: publishable.map((event) => ({
          id: event.id,
          type: event.eventType,
          date: event.eventDate,
          country: event.country,
          mileageKm: event.mileageKm,
          title: event.title,
          description: event.description,
          quality: event.quality,
          source: { key: event.source.key, name: event.source.name }
        })),
        requestId: id
      },
      { headers: { 'x-request-id': id } }
    );
  } catch (error) {
    return unexpectedApiError(error, id, 503);
  }
}
