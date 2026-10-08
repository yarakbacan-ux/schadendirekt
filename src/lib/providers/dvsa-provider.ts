import { getDvsaConfigurationStatus } from '@/lib/dvsa-auth';
import { dvsaClient } from '@/lib/dvsa-client';
import { mapDvsaVehicle } from '@/lib/dvsa-mapping';
import type { VehicleDataProvider } from '@/lib/providers/types';

export const DVSA_SOURCE_KEY = 'dvsa-mot';

export const dvsaProvider: VehicleDataProvider = {
  key: DVSA_SOURCE_KEY,
  name: 'DVSA MOT History',
  description: 'Offizielle technische MOT-Prüfungs- und Kilometerhistorie für unterstützte Fahrzeuge in Großbritannien. Keine Unfall- oder Versicherungshistorie.',
  capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'],
  authType: 'OAUTH2_CLIENT_CREDENTIALS',
  refreshPolicy: 'Pro FIN höchstens einmal pro 24 Stunden live abrufen, sofern der letzte erfolgreiche Lauf noch frisch ist.',
  rateLimitPolicy: 'Provider-Limits respektieren; lokales Throttling, Retry/Backoff bei 429.',
  mappingVersion: 'dvsa-mot-v1',
  coverage: [
    {
      marketCode: 'GB',
      capabilities: ['VEHICLE_SPECS', 'ODOMETER', 'INSPECTION', 'REGISTRATION'],
      status: 'LIVE',
      requiresCredentials: true,
      requiresContract: false,
      requiresLicense: true,
      freshnessHours: 24,
      qualityNote: 'MOT-Prüfungsdaten sind technische Prüfungsdaten; keine Unfall- oder Versicherungshistorie.',
      notes: 'Nur für den ausdrücklich dokumentierten GB-Markt aufrufen. Bei unbekanntem Markt nicht raten.'
    }
  ],
  mapping: {
    registration: 'registration',
    make: 'make',
    model: 'model',
    fuelType: 'fuelType',
    engineSize: 'engineDisplacement',
    firstUsedDate: 'registration',
    motTests: 'INSPECTION',
    'motTests.odometerValue': 'mileageKm',
    'motTests.defects': 'rawPayload.defects'
  },
  configurationStatus() {
    return getDvsaConfigurationStatus();
  },
  async lookup(vin) {
    const vehicle = await dvsaClient.getVehicleByVin(vin);
    if (!vehicle) return { cached: false, attributes: [], events: [], warnings: ['DVSA_NOT_FOUND'] };
    return mapDvsaVehicle(vehicle);
  }
};
