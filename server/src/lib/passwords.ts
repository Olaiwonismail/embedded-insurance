import { randomBytes, scrypt, timingSafeEqual } from 'crypto';

// scrypt with OWASP's recommended cost (N=2^17, r=8, p=1).
// Stored format: scrypt$N$r$p$salt$hash (salt and hash base64), so the cost can be
// raised later without breaking existing hashes.
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
// scrypt needs 128 * N * r bytes; allow that plus headroom, and no more.
const maxmemFor = (n: number, r: number) => 128 * n * r * 2;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: n, r, p, maxmem: maxmemFor(n, r) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // Refuse costs we would never write, so a bad row cannot exhaust memory.
  if (![n, r, p].every(Number.isInteger) || n > N || r > R || p > P) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const actual = await derive(password, salt, n, r, p);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash of a random password. Checked when the email is unknown, so a wrong
// email takes as long as a wrong password and does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
