import { decodeVinWithNhtsa, NHTSA_FIELD_SOURCES, NHTSA_SOURCE_KEY } from '@/lib/nhtsa';
import type { ProviderAttribute, VehicleDataProvider } from '@/lib/providers/types';

export const nhtsaProvider: VehicleDataProvider = {
  key: NHTSA_SOURCE_KEY,
  name: 'NHTSA vPIC',
  description: 'NHTSA Product Information Catalog / Vehicle Listing. Stammdaten und VIN-Decoding, keine Unfallhistorie.',
  capabilities: ['VIN_DECODE', 'VEHICLE_SPECS'],
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
