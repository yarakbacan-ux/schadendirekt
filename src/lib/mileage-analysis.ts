export type MileageAnalysisStatus = 'OK' | 'NOTICE' | 'SUSPICIOUS' | 'INSUFFICIENT_DATA';

export type MileageEventLike = {
  id: string;
  eventDate: Date | string | null;
  mileageKm: number | null;
};

export type MileageFinding = {
  code: 'BACKWARD_READING' | 'STATIC_LONG_PERIOD' | 'EXTREME_JUMP' | 'SAME_DATE_CONFLICT';
  severity: 'NOTICE' | 'SUSPICIOUS';
  message: string;
  eventIds: string[];
  details: Record<string, number | string>;
};

export type MileageAnalysis = {
  status: MileageAnalysisStatus;
  readings: Array<{ eventId: string; date: string; mileageKm: number }>;
  findings: MileageFinding[];
};

const DAY_MS = 86_400_000;

function validReading(event: MileageEventLike) {
  if (event.mileageKm == null || !Number.isFinite(event.mileageKm) || event.mileageKm < 0 || !event.eventDate) return null;
  const date = event.eventDate instanceof Date ? event.eventDate : new Date(event.eventDate);
  if (Number.isNaN(date.getTime())) return null;
  return { id: event.id, date, mileageKm: event.mileageKm };
}

export function analyzeMileage(events: MileageEventLike[]): MileageAnalysis {
  const readings = events
    .map(validReading)
    .filter((value): value is NonNullable<ReturnType<typeof validReading>> => Boolean(value))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  const serialized = readings.map((reading) => ({
    eventId: reading.id,
    date: reading.date.toISOString(),
    mileageKm: reading.mileageKm
  }));

  if (readings.length < 2) {
    return { status: 'INSUFFICIENT_DATA', readings: serialized, findings: [] };
  }

  const findings: MileageFinding[] = [];

  for (let index = 1; index < readings.length; index += 1) {
    const previous = readings[index - 1];
    const current = readings[index];
    const deltaKm = current.mileageKm - previous.mileageKm;
    const deltaDays = Math.max(0, (current.date.getTime() - previous.date.getTime()) / DAY_MS);

    if (deltaDays === 0 && current.mileageKm !== previous.mileageKm) {
      findings.push({
        code: 'SAME_DATE_CONFLICT',
        severity: 'SUSPICIOUS',
        message: 'Am selben Datum wurden unterschiedliche Kilometerstände gemeldet.',
        eventIds: [previous.id, current.id],
        details: { previousKm: previous.mileageKm, currentKm: current.mileageKm }
      });
      continue;
    }

    if (deltaKm < 0) {
      findings.push({
        code: 'BACKWARD_READING',
        severity: 'SUSPICIOUS',
        message: 'Ein späterer Datensatz weist einen niedrigeren Kilometerstand auf.',
        eventIds: [previous.id, current.id],
        details: { previousKm: previous.mileageKm, currentKm: current.mileageKm, deltaKm }
      });
    }

    if (deltaKm === 0 && deltaDays >= 365) {
      findings.push({
        code: 'STATIC_LONG_PERIOD',
        severity: 'NOTICE',
        message: 'Der gleiche Kilometerstand wurde über einen ungewöhnlich langen Zeitraum gemeldet.',
        eventIds: [previous.id, current.id],
        details: { mileageKm: current.mileageKm, deltaDays: Math.round(deltaDays) }
      });
    }

    const kmPerDay = deltaDays > 0 ? deltaKm / deltaDays : 0;
    if (deltaKm > 100_000 && deltaDays <= 180 || deltaKm > 0 && kmPerDay > 800) {
      findings.push({
        code: 'EXTREME_JUMP',
        severity: 'NOTICE',
        message: 'Der Kilometerstand ist in kurzer Zeit außergewöhnlich stark gestiegen.',
        eventIds: [previous.id, current.id],
        details: { deltaKm, deltaDays: Math.round(deltaDays), kmPerDay: Math.round(kmPerDay) }
      });
    }
  }

  const status: MileageAnalysisStatus = findings.some((finding) => finding.severity === 'SUSPICIOUS')
    ? 'SUSPICIOUS'
    : findings.length > 0
      ? 'NOTICE'
      : 'OK';

  return { status, readings: serialized, findings };
}
