import { decodeVinWithNhtsa, NHTSA_FIELD_SOURCES, NHTSA_SOURCE_KEY } from '@/lib/nhtsa';
import type { ProviderAttribute, VehicleDataProvider } from '@/lib/providers/types';

export const nhtsaProvider: VehicleDataProvider = {
  key: NHTSA_SOURCE_KEY,
  name: 'NHTSA vPIC',
  description: 'NHTSA Product Information Catalog / Vehicle Listing. Stammdaten und VIN-Decoding, keine Unfallhistorie.',
  capabilities: ['VIN_DECODE', 'VEHICLE_SPECS'],
  authType: 'NONE',
  refreshPolicy: 'VIN-Decoding höchstens einmal pro 24 Stunden erneut live abrufen.',
  rateLimitPolicy: 'Öffentliche Quelle; lokale Schonung und Cache verwenden.',
  mappingVersion: 'nhtsa-vpic-v1',
  coverage: [
    {
      marketCode: 'GLOBAL',
      capabilities: ['VIN_DECODE', 'VEHICLE_SPECS'],
      status: 'PARTIAL',
      requiresCredentials: false,
      requiresContract: false,
      requiresLicense: false,
      freshnessHours: 24,
      qualityNote: 'VIN-Decoding kann je Hersteller/Markt unvollständig sein. Dies ist keine Historienabdeckung.',
      notes: 'GLOBAL bedeutet hier ausschließlich technische VIN-/Stammdatenabfrage, nicht Schaden-, Service- oder Kilometerhistorie.'
    }
  ],
  mapping: Object.fromEntries(Object.entries(NHTSA_FIELD_SOURCES)),
  async lookup(vin) {
    const decoded = await decodeVinWithNhtsa(vin);
    const fetchedAt = new Date();
    const attributes: ProviderAttribute[] = Object.entries(decoded.mapped)
      .filter((entry): entry is [keyof typeof decoded.mapped, string | number] => entry[1] !== undefined)
      .map(([field, value]) => ({
        field,
        value: String(value),
        sourceField: NHTSA_FIELD_SOURCES[field],
        rawValue: String(value),
        quality: 'VERIFIED',
        fetchedAt
      }));

    return {
      cached: decoded.cached,
      attributes,
      events: [],
      warnings: decoded.canStore ? [] : ['SOURCE_STORAGE_NOT_LICENSED']
    };
  }
};
