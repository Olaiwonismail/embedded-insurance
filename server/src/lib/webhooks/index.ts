import { PlatformVerifier } from './types';
import { ShopifyVerifier } from './shopify';
import { CustomVerifier } from './custom';

export * from './types';
export * from './crypto';
export * from './shopify';
export * from './custom';

const verifiers: Record<string, PlatformVerifier> = {
  shopify: new ShopifyVerifier(),
  custom: new CustomVerifier(),
};

export function getPlatformVerifier(platform: string): PlatformVerifier | undefined {
  return verifiers[platform];
}
