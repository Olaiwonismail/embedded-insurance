import 'dotenv/config';

const ENCRYPTION_KEY_BYTES = 32;

// ENCRYPTION_KEY: 32 bytes, base64. Used for AES-256-GCM on webhook secrets.
export function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== ENCRYPTION_KEY_BYTES || key.toString('base64') !== raw) {
    throw new Error(`ENCRYPTION_KEY must be ${ENCRYPTION_KEY_BYTES} bytes encoded as base64`);
  }
  return key;
}

// DEFAULT_COMMISSION_RATE: a fraction such as 0.1 (10%). Fits numeric(5, 4).
export function getDefaultCommissionRate(): string {
  const raw = process.env.DEFAULT_COMMISSION_RATE;
  if (!raw || !/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/.test(raw)) {
    throw new Error('DEFAULT_COMMISSION_RATE must be a number from 0 to 1 with at most 4 decimals');
  }
  return raw;
}

// Called once at startup so the app refuses to start with bad configuration.
export function assertConfig(): void {
  getEncryptionKey();
  getDefaultCommissionRate();
}
