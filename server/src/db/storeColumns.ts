import { storesTable } from './schema';

// Every store column except the secrets (secret key hash, webhook secret, password hash). Select with these whenever the result
// may reach a route or a response, so the secrets cannot leak by mistake.
export const storeColumnsWithoutSecrets = {
  id: storesTable.id,
  name: storesTable.name,
  status: storesTable.status,
  platform: storesTable.platform,
  publicKey: storesTable.publicKey,
  allowedDomains: storesTable.allowedDomains,
  commissionRate: storesTable.commissionRate,
  settlementFrequency: storesTable.settlementFrequency,
  billingEmail: storesTable.billingEmail,
  enabledCategories: storesTable.enabledCategories,
  createdAt: storesTable.createdAt,
};

export type StoreWithoutSecrets = Omit<
  typeof storesTable.$inferSelect,
  'secretKeyHash' | 'webhookSecret' | 'passwordHash'
>;
