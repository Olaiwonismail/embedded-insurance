import { createHash } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { createDb } from '../src/db';
import { storesTable } from '../src/db/schema';
import { generatePublicKey } from '../src/lib/keys';

// Real implementation, wrapped so one test can force a public key collision.
vi.mock('../src/lib/keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/keys')>();
  return { ...actual, generatePublicKey: vi.fn(actual.generatePublicKey) };
});
import { decryptSecret } from '../src/lib/secrets';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);
const ENDPOINT = '/v1/onboardStores';

const validBody = () => ({
  name: '3C Hub',
  platform: 'shopify',
  allowedDomains: ['3chub.com', 'shop.3chub.com'],
  enabledCategories: ['phones', 'laptops'],
  billingEmail: 'billing@3chub.com',
});

async function findStore(id: number) {
  const [row] = await db.select().from(storesTable).where(eq(storesTable.id, id));
  return row;
}

async function storeCount() {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(storesTable);
  return count;
}

describe('POST /v1/onboardStores', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  it('creates a pending store and returns both keys', async () => {
    const res = await request(createApp(db)).post(ENDPOINT).send(validBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: '3C Hub',
      status: 'pending',
      allowedDomains: ['3chub.com', 'shop.3chub.com'],
      enabledCategories: ['phones', 'laptops'],
    });
    expect(res.body.id).toEqual(expect.any(Number));
    expect(res.body.publicKey).toMatch(/^pk_live_[A-Za-z0-9_-]{24}$/);
    expect(res.body.secretKey).toMatch(/^sk_live_/);
    expect(res.body).not.toHaveProperty('secretKeyHash');
    expect(res.body).not.toHaveProperty('commissionRate');

    const row = await findStore(res.body.id);
    expect(row.status).toBe('pending');
    expect(row.settlementFrequency).toBe('daily');
    expect(row.publicKey).toBe(res.body.publicKey);
  });

  it('stores only the SHA-256 hash of the secret key', async () => {
    const res = await request(createApp(db)).post(ENDPOINT).send(validBody());
    const row = await findStore(res.body.id);

    expect(row.secretKeyHash).not.toBe(res.body.secretKey);
    expect(row.secretKeyHash).toBe(createHash('sha256').update(res.body.secretKey).digest('hex'));
  });

  it('encrypts a supplied webhook secret and does not return it', async () => {
    const supplied = 'shpss_merchant_supplied_secret';
    const res = await request(createApp(db))
      .post(ENDPOINT)
      .send({ ...validBody(), webhookSecret: supplied });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('webhookSecret');
    expect(JSON.stringify(res.body)).not.toContain(supplied);

    const row = await findStore(res.body.id);
    expect(row.webhookSecret).not.toBe(supplied);
    expect(row.webhookSecret).not.toContain(supplied);
    expect(decryptSecret(row.webhookSecret)).toBe(supplied);
  });

  it('generates, encrypts and returns a webhook secret when none is supplied', async () => {
    const res = await request(createApp(db)).post(ENDPOINT).send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.webhookSecret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const row = await findStore(res.body.id);
    expect(row.webhookSecret).not.toContain(res.body.webhookSecret);
    expect(decryptSecret(row.webhookSecret)).toBe(res.body.webhookSecret);
  });

  it('uses the configured default commission rate', async () => {
    const res = await request(createApp(db)).post(ENDPOINT).send(validBody());
    const row = await findStore(res.body.id);
    expect(Number(row.commissionRate)).toBe(Number(process.env.DEFAULT_COMMISSION_RATE));
  });

  it.each([
    ['commissionRate', '0.9999'],
    ['status', 'active'],
    ['settlementFrequency', 'weekly'],
    ['secretKeyHash', 'abc'],
    ['publicKey', 'pk_live_mine'],
  ])('refuses a request that tries to set %s', async (field, value) => {
    const res = await request(createApp(db))
      .post(ENDPOINT)
      .send({ ...validBody(), [field]: value });

    expect(res.status).toBe(400);
    expect(await storeCount()).toBe(0);
  });

  const { name: _n, ...noName } = validBody();
  const { billingEmail: _b, ...noEmail } = validBody();

  it.each<[string, unknown]>([
    ['missing name', noName],
    ['empty name', { ...validBody(), name: '' }],
    ['name over 255 characters', { ...validBody(), name: 'a'.repeat(256) }],
    ['unknown platform', { ...validBody(), platform: 'magento' }],
    ['no allowedDomains', { ...validBody(), allowedDomains: [] }],
    ['domain with scheme', { ...validBody(), allowedDomains: ['https://3chub.com'] }],
    ['domain with path', { ...validBody(), allowedDomains: ['3chub.com/shop'] }],
    ['uppercase domain', { ...validBody(), allowedDomains: ['3CHub.com'] }],
    ['domain with port', { ...validBody(), allowedDomains: ['3chub.com:8080'] }],
    ['no enabledCategories', { ...validBody(), enabledCategories: [] }],
    ['unknown category', { ...validBody(), enabledCategories: ['cars'] }],
    ['missing billingEmail', noEmail],
    ['invalid billingEmail', { ...validBody(), billingEmail: 'not-an-email' }],
    ['empty webhookSecret', { ...validBody(), webhookSecret: '' }],
    ['non-string webhookSecret', { ...validBody(), webhookSecret: 123 }],
    ['unknown field', { ...validBody(), insurerId: 1 }],
  ])('returns 400 for %s', async (_case, body) => {
    const res = await request(createApp(db)).post(ENDPOINT).send(body as object);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid request');
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(await storeCount()).toBe(0);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(createApp(db))
      .post(ENDPOINT)
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('retries once with a new public key on a collision', async () => {
    const first = await request(createApp(db)).post(ENDPOINT).send(validBody());
    const mocked = vi.mocked(generatePublicKey);
    mocked.mockClear();
    mocked.mockReturnValueOnce(first.body.publicKey);

    const res = await request(createApp(db)).post(ENDPOINT).send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.publicKey).not.toBe(first.body.publicKey);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(await storeCount()).toBe(2);
  });

  it('returns 429 on the sixth request within a minute from one address', async () => {
    const app = createApp(db);
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post(ENDPOINT).send(validBody());
      expect(res.status).toBe(201);
    }
    const res = await request(app).post(ENDPOINT).send(validBody());
    expect(res.status).toBe(429);
    expect(await storeCount()).toBe(5);
  });
});
