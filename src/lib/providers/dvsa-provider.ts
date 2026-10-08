import { getDvsaConfigurationStatus } from '@/lib/dvsa-auth';
import { dvsaClient } from '@/lib/dvsa-client';
import { mapDvsaVehicle } from '@/lib/dvsa-mapping';
import type { VehicleDataProvider } from '@/lib/providers/types';

export const DVSA_SOURCE_KEY = 'dvsa-mot';
export const DVSA_MAPPING_VERSION = 'dvsa-mot-v1';

export const dvsaProvider: VehicleDataProvider = {
  key: DVSA_SOURCE_KEY,
  name: 'DVSA MOT History',
  description: 'Offizielle technische MOT-Prüfungs- und Kilometerhistorie für unterstützte Fahrzeuge in Großbritannien. Keine Unfall- oder Versicherungshistorie.',
  capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'],
  authType: 'OAUTH2_API_KEY',
  mappingVersion: DVSA_MAPPING_VERSION,
  refreshPolicy: { mode: 'CACHE', maxAgeSeconds: 24 * 60 * 60 },
  rateLimit: { requestsPerMinute: 60, note: 'Lokales defensives Limit; Upstream-Limits bleiben maßgeblich.' },
  coverage: [{
    market: 'GB',
    capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'],
    status: 'PARTIAL',
    requirements: ['CREDENTIALS', 'LICENSE'],
    allowUnknownMarket: false,
    qualityNote: 'Offizielle MOT-History-Quelle. Historische Vollständigkeit und fahrzeugbezogene Verfügbarkeit werden nicht aus einem Nichttreffer abgeleitet.'
  }],
  configurationStatus() {
    return getDvsaConfigurationStatus();
  },
  async lookup(vin) {
    const vehicle = await dvsaClient.getVehicleByVin(vin);
    if (!vehicle) return { cached: false, availability: 'NO_DATA', mappingVersion: DVSA_MAPPING_VERSION, attributes: [], events: [], warnings: ['DVSA_NOT_FOUND'] };
    const mapped = mapDvsaVehicle(vehicle);
    return { ...mapped, availability: 'DATA', mappingVersion: DVSA_MAPPING_VERSION };
  }
};
