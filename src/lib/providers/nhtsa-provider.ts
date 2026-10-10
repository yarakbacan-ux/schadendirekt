import { decodeVinWithNhtsa, NHTSA_FIELD_SOURCES, NHTSA_SOURCE_KEY } from '@/lib/nhtsa';
import type { ProviderAttribute, VehicleDataProvider } from '@/lib/providers/types';

export const NHTSA_MAPPING_VERSION = 'nhtsa-vpic-v1';

export const nhtsaProvider: VehicleDataProvider = {
  key: NHTSA_SOURCE_KEY,
  name: 'NHTSA vPIC',
  description: 'NHTSA Product Information Catalog / Vehicle Listing. Stammdaten und VIN-Decoding, keine Unfallhistorie.',
  capabilities: ['VIN_DECODE', 'VEHICLE_SPECS'],
  authType: 'NONE',
  mappingVersion: NHTSA_MAPPING_VERSION,
  refreshPolicy: { mode: 'CACHE', maxAgeSeconds: 30 * 24 * 60 * 60 },
  rateLimit: { note: 'Keine Schadendirekt-Garantie für ein öffentliches Upstream-Limit; lokal defensiv nutzen.' },
  coverage: [{
    market: '*',
    capabilities: ['VIN_DECODE', 'VEHICLE_SPECS'],
    status: 'PARTIAL',
    requirements: [],
    allowUnknownMarket: true,
    qualityNote: 'Technischer VIN-Decoder. Vollständigkeit einzelner Felder ist fahrzeug- und marktabhängig; keine Historien- oder Schadenabdeckung.'
  }],
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
        capability: 'VEHICLE_SPECS',
        quality: 'VERIFIED',
        fetchedAt
      }));

    return {
      cached: decoded.cached,
      availability: attributes.length > 0 ? 'DATA' : 'NO_DATA',
      mappingVersion: NHTSA_MAPPING_VERSION,
      attributes,
      events: [],
      warnings: decoded.canStore ? [] : ['SOURCE_STORAGE_NOT_LICENSED']
    };
  }
};
