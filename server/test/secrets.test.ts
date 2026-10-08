import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/lib/secrets';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips the original text', () => {
    const stored = encryptSecret('whsec_hello');
    expect(stored).not.toContain('whsec_hello');
    expect(stored.split(':')).toHaveLength(3);
    expect(decryptSecret(stored)).toBe('whsec_hello');
  });

  it('throws when decrypting with a different key', () => {
    const stored = encryptSecret('whsec_hello');
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });

  it('throws when the stored string has been altered', () => {
    const [nonce, tag, ciphertext] = encryptSecret('whsec_hello').split(':');
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff;
    expect(() => decryptSecret([nonce, tag, bytes.toString('base64')].join(':'))).toThrow();

    const tagBytes = Buffer.from(tag, 'base64');
    tagBytes[0] ^= 0xff;
    expect(() => decryptSecret([nonce, tagBytes.toString('base64'), ciphertext].join(':'))).toThrow();

    expect(() => decryptSecret('not-a-secret')).toThrow();
  });

  it('gives different output when encrypting the same text twice', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });
});
