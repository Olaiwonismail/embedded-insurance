import crypto from 'crypto';

/**
 * Compares two strings in constant time using crypto.timingSafeEqual.
 * Returns false if lengths do not match or if either input is invalid.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
