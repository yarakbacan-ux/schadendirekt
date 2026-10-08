import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const CONFIRMATION = 'I_HAVE_REVIEWED_THE_NHTSA_TERMS';

async function main() {
  if (process.env.NHTSA_LICENSE_APPROVAL !== CONFIRMATION) {
    throw new Error(`Set NHTSA_LICENSE_APPROVAL=${CONFIRMATION} after an actual terms/legal review.`);
  }

  const reviewedBy = process.env.NHTSA_LICENSE_REVIEWED_BY?.trim();
  const termsUrl = process.env.NHTSA_LICENSE_TERMS_URL?.trim();
  const notes = process.env.NHTSA_LICENSE_NOTES?.trim();
  if (!reviewedBy || !termsUrl || !notes) {
    throw new Error('NHTSA_LICENSE_REVIEWED_BY, NHTSA_LICENSE_TERMS_URL and NHTSA_LICENSE_NOTES are required.');
  }

  const source = await db.dataSource.upsert({
    where: { key: 'nhtsa-vpic' },
    update: {
      name: 'NHTSA vPIC',
      description: 'NHTSA Product Information Catalog / Vehicle Listing. Technische Identifikations- und Stammdaten, keine Unfallhistorie.'
    },
    create: {
      key: 'nhtsa-vpic',
      name: 'NHTSA vPIC',
      active: true,
      description: 'NHTSA Product Information Catalog / Vehicle Listing. Technische Identifikations- und Stammdaten, keine Unfallhistorie.'
    }
  });

  const existing = await db.sourceLicense.findFirst({
    where: { sourceId: source.id, licenseName: 'NHTSA vPIC reviewed terms' },
    orderBy: { updatedAt: 'desc' }
  });

  const data = {
    termsUrl,
    canStore: true,
    canRedistribute: true,
    canCommercialize: true,
    retentionDays: null,
    reviewedAt: new Date(),
    reviewedBy,
    notes,
    validFrom: new Date(),
    validUntil: null
  };

  const license = existing
    ? await db.sourceLicense.update({ where: { id: existing.id }, data })
    : await db.sourceLicense.create({
        data: { sourceId: source.id, licenseName: 'NHTSA vPIC reviewed terms', ...data }
      });

  console.log(`NHTSA license explicitly approved: ${license.id} by ${reviewedBy}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
