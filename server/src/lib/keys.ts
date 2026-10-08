import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// 18 random bytes encode to exactly 24 base64url characters.
export function generatePublicKey(): string {
  return `pk_live_${randomBytes(18).toString('base64url')}`;
}

export function generateSecretKey(): string {
  return `sk_live_${randomBytes(32).toString('base64url')}`;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

// The secret key is long and random, so plain SHA-256 is enough (no slow password hash).
export function hashSecretKey(secretKey: string): string {
  return createHash('sha256').update(secretKey).digest('hex');
}

export function secretKeyMatches(secretKey: string, storedHash: string): boolean {
  const actual = Buffer.from(hashSecretKey(secretKey), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
