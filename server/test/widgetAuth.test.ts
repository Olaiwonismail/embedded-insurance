import express, { Express } from 'express';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../src/db';
import { storesTable } from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import {
  PUBLIC_KEY_HEADER,
  createWidgetAuth,
  isAllowedOrigin,
} from '../src/middleware/widgetAuth';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

async function insertStore(overrides: { status?: string; allowedDomains?: string[] } = {}) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: '3C Hub',
      platform: 'shopify',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['3chub.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: 'billing@3chub.com',
      status: 'active',
      ...overrides,
    })
    .returning();
  return store;
}

// The check in front of a route that reports which store it was given.
function probeApp(): Express {
  const app = express();
  app.use(createWidgetAuth(db));
  app.get('/probe', (req, res) => {
    res.json({ store: req.store });
  });
  return app;
}

function probe(publicKey?: string, origin?: string) {
  const req = request(probeApp()).get('/probe');
  if (publicKey !== undefined) req.set(PUBLIC_KEY_HEADER, publicKey);
  if (origin !== undefined) req.set('Origin', origin);
  return req;
}

describe('widget request check', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  it('returns 401 for an unknown public key', async () => {
    await insertStore();
    const res = await probe(generatePublicKey(), 'https://3chub.com');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the public key header is missing', async () => {
    const res = await probe(undefined, 'https://3chub.com');
    expect(res.status).toBe(401);
  });

  it.each(['pending', 'suspended'])('returns 403 for a %s store', async (status) => {
    const store = await insertStore({ status });
    const res = await probe(store.publicKey, 'https://3chub.com');
    expect(res.status).toBe(403);
  });

  it('returns 403 when the Origin header is missing', async () => {
    const store = await insertStore();
    const res = await probe(store.publicKey);
    expect(res.status).toBe(403);
  });

  it('returns 403 for an Origin of "null"', async () => {
    const store = await insertStore();
    const res = await probe(store.publicKey, 'null');
    expect(res.status).toBe(403);
  });

  it('returns 403 for a domain not in allowedDomains', async () => {
    const store = await insertStore();
    const res = await probe(store.publicKey, 'https://othershop.com');
    expect(res.status).toBe(403);
  });

  it.each(['https://evil3chub.com', 'https://3chub.com.evil.com'])(
    'returns 403 for %s against a store listing 3chub.com',
    async (origin) => {
      const store = await insertStore();
      const res = await probe(store.publicKey, origin);
      expect(res.status).toBe(403);
    },
  );

  it('lets an exact domain through and attaches the store', async () => {
    const store = await insertStore();
    const res = await probe(store.publicKey, 'https://3chub.com');

    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ id: store.id, publicKey: store.publicKey });
  });

  it.each([
    'https://www.3chub.com',
    'https://shop.eu.3chub.com',
    'https://3chub.com:8443',
    'https://WWW.3CHUB.COM',
  ])('lets %s through', async (origin) => {
    const store = await insertStore();
    const res = await probe(store.publicKey, origin);

    expect(res.status).toBe(200);
    expect(res.body.store.id).toBe(store.id);
  });

  it('does not attach the store secrets', async () => {
    const store = await insertStore();
    const res = await probe(store.publicKey, 'https://3chub.com');

    expect(res.body.store).not.toHaveProperty('secretKeyHash');
    expect(res.body.store).not.toHaveProperty('webhookSecret');
  });
});

describe('isAllowedOrigin', () => {
  const domains = ['3chub.com'];

  it.each([
    'https://3chub.com',
    'http://3chub.com',
    'https://www.3chub.com',
    'https://a.b.3chub.com',
    'https://3chub.com:8080',
    'https://3chub.com.',
  ])('allows %s', (origin) => {
    expect(isAllowedOrigin(origin, domains)).toBe(true);
  });

  it.each([
    undefined,
    '',
    'null',
    '3chub.com',
    'ftp://3chub.com',
    'https://evil3chub.com',
    'https://3chub.com.evil.com',
    'https://3chub.co',
    'https://com',
  ])('refuses %s', (origin) => {
    expect(isAllowedOrigin(origin, domains)).toBe(false);
  });

  it('refuses everything when no domains are listed', () => {
    expect(isAllowedOrigin('https://3chub.com', [])).toBe(false);
  });
});
