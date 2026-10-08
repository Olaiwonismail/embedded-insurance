import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getEncryptionKey } from '../config';

// AES-256-GCM. Stored format: nonce:authTag:ciphertext, each part base64.
const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function encryptSecret(plaintext: string, key: Buffer = getEncryptionKey()): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [nonce, authTag, ciphertext].map((part) => part.toString('base64')).join(':');
}

// Throws on a wrong key, an altered string, or a malformed value.
export function decryptSecret(stored: string, key: Buffer = getEncryptionKey()): string {
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted secret');
  }
  const [nonce, authTag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64'));
  if (nonce.length !== NONCE_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error('Malformed encrypted secret');
  }

  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
