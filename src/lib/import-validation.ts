import { z } from 'zod';
import { isValidVin, normalizeVin } from '@/lib/vin';

const ISO_ALPHA_2 = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ')
);

const isoDate = z.string().refine((value) => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}, 'INVALID_EVENT_DATE');

export const ImportRecordSchema = z.object({
  vin: z.string().transform(normalizeVin).refine(isValidVin, 'INVALID_VIN'),
  externalId: z.string().trim().min(1).optional(),
  eventType: z.string().trim().min(1, 'EVENT_TYPE_REQUIRED').max(100),
  eventDate: isoDate.optional(),
  country: z.string().trim().toUpperCase().refine((value) => ISO_ALPHA_2.has(value), 'INVALID_COUNTRY').optional(),
  mileageKm: z.coerce.number().int().min(0).max(5_000_000).optional(),
  title: z.string().trim().min(1, 'TITLE_REQUIRED').max(500),
  description: z.string().trim().max(10_000).optional()
});

export type ImportRecord = z.infer<typeof ImportRecordSchema>;

export function validateImportRecord(input: unknown): ImportRecord {
  return ImportRecordSchema.parse(input);
}
