import { dvsaProvider } from '@/lib/providers/dvsa-provider';
import { nhtsaProvider } from '@/lib/providers/nhtsa-provider';
import type { ProviderCapability, VehicleDataProvider } from '@/lib/providers/types';

const providers: VehicleDataProvider[] = [nhtsaProvider, dvsaProvider];

export function listProviders(): readonly VehicleDataProvider[] {
  return providers;
}

export function getProvider(key: string): VehicleDataProvider | null {
  return providers.find((provider) => provider.key === key) ?? null;
}

export function getProvidersForCapability(capability: ProviderCapability): VehicleDataProvider[] {
  return providers.filter((provider) => provider.capabilities.includes(capability));
}

export function selectProviders(options: {
  providerKeys?: readonly string[];
  capabilities?: readonly ProviderCapability[];
} = {}): VehicleDataProvider[] {
  const keySet = options.providerKeys ? new Set(options.providerKeys) : null;
  const capabilitySet = options.capabilities ? new Set(options.capabilities) : null;

  return providers.filter((provider) => {
    if (keySet && !keySet.has(provider.key)) return false;
    if (capabilitySet && !provider.capabilities.some((capability) => capabilitySet.has(capability))) return false;
    return true;
  });
}
