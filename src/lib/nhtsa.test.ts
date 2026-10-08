import { describe, expect, it } from 'vitest';
import { mapNhtsaResult } from '@/lib/nhtsa';

describe('mapNhtsaResult', () => {
  it('maps only present vPIC fields into structured vehicle data', () => {
    const mapped = mapNhtsaResult({
      Make: 'BMW',
      Model: 'X5',
      ModelYear: '2021',
      BodyClass: 'Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle (MPV)',
      FuelTypePrimary: 'Diesel',
      DisplacementL: '3.0',
      EngineKW: '210',
      TransmissionStyle: 'Automatic',
      Manufacturer: 'BMW AG',
      PlantCountry: 'GERMANY',
      VehicleType: 'MULTIPURPOSE PASSENGER VEHICLE (MPV)'
    });

    expect(mapped).toMatchObject({
      make: 'BMW',
      model: 'X5',
      modelYear: 2021,
      fuelType: 'Diesel',
      engineDisplacement: 3,
      enginePowerKw: 210,
      transmission: 'Automatic',
      manufacturer: 'BMW AG',
      plantCountry: 'GERMANY'
    });
  });

  it('derives kW from horsepower only when EngineKW is unavailable', () => {
    expect(mapNhtsaResult({ EngineHP: '300' }).enginePowerKw).toBeCloseTo(223.7, 1);
  });

  it('does not invent missing fields', () => {
    expect(mapNhtsaResult({ Make: 'Audi', Model: '' })).toEqual({
      make: 'Audi',
      model: undefined,
      modelYear: undefined,
      bodyClass: undefined,
      fuelType: undefined,
      engineDisplacement: undefined,
      enginePowerKw: undefined,
      transmission: undefined,
      manufacturer: undefined,
      plantCountry: undefined,
      vehicleType: undefined
    });
  });
});
