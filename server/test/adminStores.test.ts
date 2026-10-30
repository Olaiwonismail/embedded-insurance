import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { createDb } from '../src/db';
import { storesTable } from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { ADMIN_KEY_HEADER } from '../src/middleware/adminAuth';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);
const BASE = '/v1/admin/stores';
const ADMIN_KEY = process.env.ADMIN_API_KEY!;

async function insertStore(overrides: { name?: string; status?: string } = {}) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: '3C Hub',
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['3chub.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: 'billing@3chub.com',
      ...overrides,
    })
    .returning();
  return store;
}

async function statusOf(id: number) {
  const [row] = await db.select().from(storesTable).where(eq(storesTable.id, id));
  return row.status;
}

const admin = () => {
  const app = createApp(db);
  return {
    get: (path: string) => request(app).get(path).set(ADMIN_KEY_HEADER, ADMIN_KEY),
    post: (path: string) => request(app).post(path).set(ADMIN_KEY_HEADER, ADMIN_KEY),
  };
};

describe('admin stores API', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  describe('admin key', () => {
    it.each([
      ['GET', BASE],
      ['GET', `${BASE}/1`],
      ['POST', `${BASE}/1/approve`],
      ['POST', `${BASE}/1/suspend`],
    ])('%s %s returns 401 without the key', async (method, path) => {
      const app = createApp(db);
      const res = method === 'GET' ? await request(app).get(path) : await request(app).post(path);
      expect(res.status).toBe(401);
    });

    it('returns 401 for a wrong key and changes nothing', async () => {
      const store = await insertStore();
      const res = await request(createApp(db))
        .post(`${BASE}/${store.id}/approve`)
        .set(ADMIN_KEY_HEADER, `${ADMIN_KEY}x`);

      expect(res.status).toBe(401);
      expect(await statusOf(store.id)).toBe('pending');
    });
  });

  describe('GET /', () => {
    it('lists stores newest first with the table columns only', async () => {
      await insertStore({ name: 'Older' });
      await insertStore({ name: 'Newer' });

      const res = await admin().get(BASE);

      expect(res.status).toBe(200);
      expect(res.body.stores.map((s: { name: string }) => s.name)).toEqual(['Newer', 'Older']);
      expect(Object.keys(res.body.stores[0]).sort()).toEqual(
        ['allowedDomains', 'createdAt', 'enabledCategories', 'id', 'name', 'platform', 'status'],
      );
    });

    it('returns an empty list when there are no stores', async () => {
      const res = await admin().get(BASE);
      expect(res.status).toBe(200);
      expect(res.body.stores).toEqual([]);
    });
  });

  describe('GET /:id', () => {
    it('returns the store details without secrets', async () => {
      const store = await insertStore();
      const res = await admin().get(`${BASE}/${store.id}`);

      expect(res.status).toBe(200);
      expect(res.body.store).toMatchObject({
        id: store.id,
        publicKey: store.publicKey,
        billingEmail: 'billing@3chub.com',
      });
      expect(res.body.store).not.toHaveProperty('secretKeyHash');
      expect(res.body.store).not.toHaveProperty('webhookSecret');
    });

    it('returns 404 for an unknown store', async () => {
      const res = await admin().get(`${BASE}/999`);
      expect(res.status).toBe(404);
    });

    it.each(['abc', '0', '-1', '1.5', '99999999999'])('returns 400 for id %s', async (id) => {
      const res = await admin().get(`${BASE}/${id}`);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /:id/approve', () => {
    it('moves a pending store to active', async () => {
      const store = await insertStore();
      const res = await admin().post(`${BASE}/${store.id}/approve`);

      expect(res.status).toBe(200);
      expect(res.body.store.status).toBe('active');
      expect(res.body.store).not.toHaveProperty('secretKeyHash');
      expect(await statusOf(store.id)).toBe('active');
    });

    it.each(['active', 'suspended'])('returns 409 for a %s store', async (status) => {
      const store = await insertStore({ status });
      const res = await admin().post(`${BASE}/${store.id}/approve`);

      expect(res.status).toBe(409);
      expect(await statusOf(store.id)).toBe(status);
    });

    it('returns 404 for an unknown store', async () => {
      const res = await admin().post(`${BASE}/999/approve`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/suspend', () => {
    it.each(['pending', 'active'])('suspends a %s store', async (status) => {
      const store = await insertStore({ status });
      const res = await admin().post(`${BASE}/${store.id}/suspend`);

      expect(res.status).toBe(200);
      expect(res.body.store.status).toBe('suspended');
      expect(await statusOf(store.id)).toBe('suspended');
    });

    it('returns 409 for a store that is already suspended', async () => {
      const store = await insertStore({ status: 'suspended' });
      const res = await admin().post(`${BASE}/${store.id}/suspend`);
      expect(res.status).toBe(409);
    });

    it('returns 404 for an unknown store', async () => {
      const res = await admin().post(`${BASE}/999/suspend`);
      expect(res.status).toBe(404);
    });
  });
});
