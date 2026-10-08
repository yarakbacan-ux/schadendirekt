import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const CONFIRMATION = 'I_HAVE_REVIEWED_THE_DVSA_TERMS';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function bool(name) {
  const value = required(name).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function retentionDays() {
  const raw = process.env.DVSA_LICENSE_RETENTION_DAYS?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('DVSA_LICENSE_RETENTION_DAYS must be a non-negative integer or empty.');
  return parsed;
}

async function main() {
  if (process.env.DVSA_LICENSE_APPROVAL !== CONFIRMATION) {
    throw new Error(`Set DVSA_LICENSE_APPROVAL=${CONFIRMATION} only after an actual terms/legal review.`);
  }

  const reviewedBy = required('DVSA_LICENSE_REVIEWED_BY');
  const termsUrl = required('DVSA_LICENSE_TERMS_URL');
  const notes = required('DVSA_LICENSE_NOTES');
  const canStore = bool('DVSA_LICENSE_CAN_STORE');
  const canRedistribute = bool('DVSA_LICENSE_CAN_REDISTRIBUTE');
  const canCommercialize = bool('DVSA_LICENSE_CAN_COMMERCIALIZE');

  const source = await db.dataSource.upsert({
    where: { key: 'dvsa-mot' },
    update: {
      name: 'DVSA MOT History',
      description: 'Offizielle technische MOT-Prüfungs- und Kilometerhistorie für unterstützte Fahrzeuge in Großbritannien und Nordirland. Keine Unfall- oder Versicherungshistorie.'
    },
    create: {
      key: 'dvsa-mot',
      name: 'DVSA MOT History',
      active: true,
      description: 'Offizielle technische MOT-Prüfungs- und Kilometerhistorie für unterstützte Fahrzeuge in Großbritannien und Nordirland. Keine Unfall- oder Versicherungshistorie.'
    }
  });

  const existing = await db.sourceLicense.findFirst({
    where: { sourceId: source.id, licenseName: 'DVSA MOT reviewed terms' },
    orderBy: { updatedAt: 'desc' }
  });
  const data = {
    termsUrl,
    canStore,
    canRedistribute,
    canCommercialize,
    retentionDays: retentionDays(),
    reviewedAt: new Date(),
    reviewedBy,
    notes,
    validFrom: new Date(),
    validUntil: null
  };
  const license = existing
    ? await db.sourceLicense.update({ where: { id: existing.id }, data })
    : await db.sourceLicense.create({ data: { sourceId: source.id, licenseName: 'DVSA MOT reviewed terms', ...data } });

  console.log(`DVSA license policy recorded: ${license.id}. Store=${canStore}, Redistribute=${canRedistribute}, Commercialize=${canCommercialize}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
