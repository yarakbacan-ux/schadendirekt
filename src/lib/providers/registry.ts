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
  excludeProviderKeys?: readonly string[];
  capabilities?: readonly ProviderCapability[];
} = {}): VehicleDataProvider[] {
  const keySet = options.providerKeys ? new Set(options.providerKeys) : null;
  const excluded = options.excludeProviderKeys ? new Set(options.excludeProviderKeys) : null;
  const capabilitySet = options.capabilities ? new Set(options.capabilities) : null;

  return providers.filter((provider) => {
    if (keySet && !keySet.has(provider.key)) return false;
    if (excluded?.has(provider.key)) return false;
    if (capabilitySet && !provider.capabilities.some((capability) => capabilitySet.has(capability))) return false;
    return true;
  });
}

/**
 * Registers a provider in the shared registry and returns a disposer.
 * Production integrations should call this from registry composition, while
 * tests can register temporary providers without teaching report.ts source keys.
 */
export function registerProvider(provider: VehicleDataProvider): () => void {
  if (providers.some((item) => item.key === provider.key)) throw new Error(`PROVIDER_ALREADY_REGISTERED:${provider.key}`);
  providers.push(provider);
  return () => {
    const index = providers.findIndex((item) => item === provider);
    if (index >= 0) providers.splice(index, 1);
  };
}
