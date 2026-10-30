// Calls to the insureOnGo API. In development Vite forwards /v1 to the server.

export const PLATFORMS = [{ value: 'custom', label: 'Custom website' }] as const;

export const CATEGORIES = [
  { value: 'phones', label: 'Phones' },
  { value: 'laptops', label: 'Laptops' },
  { value: 'tablets', label: 'Tablets' },
] as const;

export type Platform = (typeof PLATFORMS)[number]['value'];
export type Category = (typeof CATEGORIES)[number]['value'];
export type StoreStatus = 'pending' | 'active' | 'suspended';

export function platformLabel(value: string): string {
  return PLATFORMS.find((p) => p.value === value)?.label ?? value;
}

// Merchants can also name their own products. Same rules as the server.
export const MAX_CATEGORIES = 20;
const CUSTOM_PRODUCT = /^[a-z0-9][a-z0-9 &'-]{1,49}$/;
export const CUSTOM_PRODUCT_RULE = '2 to 50 characters: letters, numbers, spaces, &, \' or -';

export function normalizeProduct(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isValidProduct(name: string): boolean {
  return CUSTOM_PRODUCT.test(name);
}

export function isStandardCategory(value: string): boolean {
  return CATEGORIES.some((c) => c.value === value);
}

export function categoryLabel(value: string): string {
  const standard = CATEGORIES.find((c) => c.value === value)?.label;
  return standard ?? value.charAt(0).toUpperCase() + value.slice(1);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: { field: string | null; message: string }[] = [],
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error ?? `The server returned an error (${res.status}).`,
      body.details,
    );
  }
  return body as T;
}

// ---- Merchant signup: POST /v1/onboardStores ----

export interface SignupInput {
  name: string;
  platform: Platform;
  allowedDomains: string[];
  enabledCategories: string[]; // standard values or merchant-named products
  billingEmail: string;
  password: string;
  webhookSecret?: string;
}

export interface SignupResult {
  id: number;
  name: string;
  status: StoreStatus;
  publicKey: string;
  secretKey: string;
  webhookSecret?: string; // only when we generated it
  allowedDomains: string[];
  enabledCategories: string[];
}

export function signUp(input: SignupInput): Promise<SignupResult> {
  return call('/v1/onboardStores', { method: 'POST', body: JSON.stringify(input) });
}

// ---- Admin: /v1/admin/stores, needs the admin key ----

export const ADMIN_KEY_HEADER = 'x-admin-key';

export interface StoreSummary {
  id: number;
  name: string;
  platform: string;
  status: StoreStatus;
  allowedDomains: string[];
  enabledCategories: string[];
  createdAt: string;
}

export interface StoreDetails extends StoreSummary {
  publicKey: string;
  billingEmail: string;
  commissionRate: string;
  settlementFrequency: string;
}

const admin = (key: string) => ({ headers: { [ADMIN_KEY_HEADER]: key } });

export function listStores(key: string): Promise<{ stores: StoreSummary[] }> {
  return call('/v1/admin/stores', admin(key));
}

export function getStore(key: string, id: number): Promise<{ store: StoreDetails }> {
  return call(`/v1/admin/stores/${id}`, admin(key));
}

export function approveStore(key: string, id: number): Promise<{ store: StoreDetails }> {
  return call(`/v1/admin/stores/${id}/approve`, { method: 'POST', ...admin(key) });
}

export function suspendStore(key: string, id: number): Promise<{ store: StoreDetails }> {
  return call(`/v1/admin/stores/${id}/suspend`, { method: 'POST', ...admin(key) });
}

// ---- Merchant dashboard: /v1/merchant, uses the session cookie set at signup or sign-in ----

export type MerchantStore = StoreDetails;

export interface Activity {
  sales: {
    policiesSold: number;
    pendingPolicies: number;
    premiumTotal: string;
    commissionTotal: string;
  };
  recentPolicies: {
    id: number;
    policyNumber: string | null;
    orderRef: string;
    itemName: string;
    itemCategory: string;
    itemPrice: string;
    premium: string;
    commissionAmount: string;
    status: 'pending' | 'active' | 'cancelled' | 'expired';
    createdAt: string;
  }[];
  settlements: {
    id: number;
    settlementDate: string;
    policyCount: number;
    premiumTotal: string;
    commissionTotal: string;
    status: 'pending' | 'invoiced' | 'paid';
  }[];
  webhookEvents: {
    id: number;
    eventId: string;
    type: string;
    status: 'received' | 'processed' | 'failed';
    receivedAt: string;
    processedAt: string | null;
  }[];
}

export function merchantLogin(email: string, password: string): Promise<{ store: MerchantStore }> {
  return call('/v1/merchant/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function merchantLogout(): Promise<unknown> {
  return call('/v1/merchant/logout', { method: 'POST' });
}

export function getMerchant(): Promise<{ store: MerchantStore }> {
  return call('/v1/merchant/me');
}

export function getActivity(): Promise<Activity> {
  return call('/v1/merchant/activity');
}
