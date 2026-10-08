import { getDvsaConfigurationStatus } from '@/lib/dvsa-auth';
import { dvsaClient } from '@/lib/dvsa-client';
import { mapDvsaVehicle } from '@/lib/dvsa-mapping';
import type { VehicleDataProvider } from '@/lib/providers/types';

export const DVSA_SOURCE_KEY = 'dvsa-mot';

export const dvsaProvider: VehicleDataProvider = {
  key: DVSA_SOURCE_KEY,
  name: 'DVSA MOT History',
  description: 'Offizielle technische MOT-Prüfungs- und Kilometerhistorie für unterstützte Fahrzeuge in Großbritannien und Nordirland. Keine Unfall- oder Versicherungshistorie.',
  capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'],
  configurationStatus() {
    return getDvsaConfigurationStatus();
  },
  async lookup(vin) {
    const vehicle = await dvsaClient.getVehicleByVin(vin);
    if (!vehicle) return { cached: false, attributes: [], events: [], warnings: ['DVSA_NOT_FOUND'] };
    return mapDvsaVehicle(vehicle);
  }
};
