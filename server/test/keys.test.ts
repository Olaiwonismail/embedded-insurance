import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  generatePublicKey,
  generateSecretKey,
  generateWebhookSecret,
  hashSecretKey,
  secretKeyMatches,
} from '../src/lib/keys';

describe('key generation', () => {
  it('public key is pk_live_ plus 24 characters', () => {
    expect(generatePublicKey()).toMatch(/^pk_live_[A-Za-z0-9_-]{24}$/);
    expect(generatePublicKey()).not.toBe(generatePublicKey());
  });

  it('secret key is sk_live_ plus 32 bytes of base64url', () => {
    const key = generateSecretKey();
    expect(key).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(key.slice('sk_live_'.length), 'base64url')).toHaveLength(32);
    expect(generateSecretKey()).not.toBe(generateSecretKey());
  });

  it('webhook secret is whsec_ plus 32 bytes of base64url', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret.slice('whsec_'.length), 'base64url')).toHaveLength(32);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });

  it('hashes the secret key with SHA-256 and checks it', () => {
    const key = generateSecretKey();
    const hash = hashSecretKey(key);
    expect(hash).toBe(createHash('sha256').update(key).digest('hex'));
    expect(secretKeyMatches(key, hash)).toBe(true);
    expect(secretKeyMatches(generateSecretKey(), hash)).toBe(false);
  });
});
