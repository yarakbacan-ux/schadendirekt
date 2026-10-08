import { db } from '@/lib/db';
import { analyzeMileage, type MileageFinding } from '@/lib/mileage-analysis';

export type EventConflictInput = {
  id: string;
  eventType: string;
  sourceEventType: string | null;
  eventDate: Date | string | null;
  country: string | null;
  mileageKm: number | null;
};

export type EventConflictResult = {
  conflictIds: Set<string>;
  mileageFindings: MileageFinding[];
  registrationConflictGroups: string[][];
};

function comparableRegistrationKey(event: EventConflictInput): string | null {
  if (event.eventType !== 'REGISTRATION' || !event.eventDate || !event.sourceEventType || !event.country) return null;
  const date = event.eventDate instanceof Date ? event.eventDate : new Date(event.eventDate);
  if (Number.isNaN(date.getTime())) return null;
  const semanticType = event.sourceEventType.trim().toUpperCase();
  if (!semanticType) return null;
  return `${date.toISOString().slice(0, 10)}|${semanticType}`;
}

export function analyzeEventConflicts(events: readonly EventConflictInput[]): EventConflictResult {
  const conflictIds = new Set<string>();
  const mileage = analyzeMileage(events.map((event) => ({
    id: event.id,
    eventDate: event.eventDate,
    mileageKm: event.mileageKm
  })));

  for (const finding of mileage.findings) {
    if (finding.code !== 'BACKWARD_READING' && finding.code !== 'SAME_DATE_CONFLICT') continue;
    for (const id of finding.eventIds) conflictIds.add(id);
  }

  const registrationGroups = new Map<string, EventConflictInput[]>();
  for (const event of events) {
    const key = comparableRegistrationKey(event);
    if (!key) continue;
    const group = registrationGroups.get(key) ?? [];
    group.push(event);
    registrationGroups.set(key, group);
  }

  const registrationConflictGroups: string[][] = [];
  for (const group of registrationGroups.values()) {
    const countries = new Set(group.map((event) => event.country?.trim().toUpperCase()).filter(Boolean));
    if (group.length < 2 || countries.size < 2) continue;
    const ids = group.map((event) => event.id).sort();
    registrationConflictGroups.push(ids);
    ids.forEach((id) => conflictIds.add(id));
  }

  // DAMAGE_RECORD is intentionally not auto-matched. Without a stable cross-source
  // incident key, equal VIN/date is not sufficient evidence that two damage records
  // describe the same incident or contradict each other.
  return { conflictIds, mileageFindings: mileage.findings, registrationConflictGroups };
}

export async function recomputeVehicleEventConflicts(vehicleId: string) {
  const events = await db.vehicleEvent.findMany({
    where: { vehicleId },
    select: {
      id: true,
      eventType: true,
      sourceEventType: true,
      eventDate: true,
      country: true,
      mileageKm: true
    }
  });
  const analysis = analyzeEventConflicts(events);
  await db.vehicleEvent.updateMany({ where: { vehicleId }, data: { conflict: false } });
  if (analysis.conflictIds.size > 0) {
    await db.vehicleEvent.updateMany({
      where: { id: { in: [...analysis.conflictIds] } },
      data: { conflict: true }
    });
  }
  return analysis;
}
