import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isValidVin, normalizeVin } from '@/lib/vin';

export async function GET(
  _request: Request,
  context: { params: Promise<{ vin: string }> }
) {
  const { vin: rawVin } = await context.params;
  const vin = normalizeVin(rawVin);

  if (!isValidVin(vin)) {
    return NextResponse.json(
      { error: 'INVALID_VIN', message: 'Die FIN muss 17 gültige Zeichen enthalten.' },
      { status: 400 }
    );
  }

  const vehicle = await db.vehicle.findUnique({
    where: { vin },
    include: {
      events: {
        where: {
          source: {
            licenses: {
              some: { canRedistribute: true }
            }
          }
        },
        include: { source: true },
        orderBy: [{ eventDate: 'desc' }, { importedAt: 'desc' }]
      }
    }
  });

  if (!vehicle) {
    return NextResponse.json({ vin, found: false, status: 'NO_DATA', events: [] });
  }

  return NextResponse.json({
    vin,
    found: true,
    status: vehicle.events.length > 0 ? 'DATA_AVAILABLE' : 'NO_DATA',
    disclaimer:
      vehicle.events.length === 0
        ? 'Für diese FIN liegen derzeit keine veröffentlichbaren Daten vor. Das bedeutet nicht, dass das Fahrzeug unfallfrei ist.'
        : undefined,
    events: vehicle.events.map((event) => ({
      id: event.id,
      type: event.eventType,
      date: event.eventDate,
      country: event.country,
      mileageKm: event.mileageKm,
      title: event.title,
      description: event.description,
      quality: event.quality,
      source: { key: event.source.key, name: event.source.name }
    }))
  });
}
