import express, { Express } from 'express';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb } from '../src/db';
import { quotesTable, storesTable } from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { InsureongoClient, InsureongoMatch } from '../src/lib/insureongo';
import { createQuotesRouter } from '../src/routes/quotes';
import { createWidgetAuth, PUBLIC_KEY_HEADER } from '../src/middleware/widgetAuth';
import {
  createWidgetPreflight,
  allowWidgetOrigin,
  hostSuffixes,
} from '../src/middleware/widgetCors';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

async function insertStore(
  overrides: { allowedDomains?: string[]; status?: string } = {},
): Promise<{ publicKey: string }> {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: 'Test Store',
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: 'billing@example.com',
      status: 'active',
      ...overrides,
    })
    .returning();
  return store;
}

const match: InsureongoMatch[] = [
  {
    quoteId: 'iog-1',
    insurerName: 'Acme Insurance',
    planName: 'Screen Protect',
    premium: '54000.00',
  },
];

function buildApp(): Express {
  const client: InsureongoClient = {
    getQuotes: vi.fn().mockResolvedValue(match),
    issuePolicy: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  // Mirrors the chain in src/app.ts: the preflight must run before the auth check.
  app.use(
    '/v1/quotes',
    createWidgetPreflight(db),
    createWidgetAuth(db),
    allowWidgetOrigin,
    createQuotesRouter(db, client),
  );
  app.use((_err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const validBody = {
  itemName: 'iPhone 15',
  itemCategory: 'phones',
  itemPrice: 999.99,
  itemCondition: 'new',
};

function preflight(app: Express, origin?: string) {
  const call = request(app).options('/v1/quotes').set('Access-Control-Request-Method', 'POST');
  return origin ? call.set('Origin', origin) : call;
}

describe('widget CORS', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${quotesTable} restart identity cascade`);
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  describe('the preflight', () => {
    it('allows an origin an active store has listed', async () => {
      await insertStore();
      const res = await preflight(buildApp(), 'https://example.com');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
      expect(res.headers['access-control-allow-methods']).toBe('POST');
      expect(res.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(res.headers['access-control-allow-headers']).toContain(PUBLIC_KEY_HEADER);
      expect(res.headers['access-control-max-age']).toBeDefined();
      expect(res.headers['vary']).toContain('Origin');
    });

    it('allows a subdomain of a listed domain', async () => {
      await insertStore();
      const res = await preflight(buildApp(), 'https://www.example.com');

      expect(res.headers['access-control-allow-origin']).toBe('https://www.example.com');
    });

    it.each([
      ['a domain no store has listed', 'https://nobody.test'],
      ['a name that only looks like a listed domain', 'https://evilexample.com'],
      ['a listed domain used as a prefix', 'https://example.com.evil.test'],
    ])('sends no allow-origin for %s', async (_name, origin) => {
      await insertStore();
      const res = await preflight(buildApp(), origin);

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('sends no allow-origin when the only matching store is not active', async () => {
      await insertStore({ status: 'pending' });
      const res = await preflight(buildApp(), 'https://example.com');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('sends no allow-origin when there is no Origin header', async () => {
      await insertStore();
      const res = await preflight(buildApp());

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers before the auth check, so a missing public key is not a 401', async () => {
      await insertStore();
      const res = await preflight(buildApp(), 'https://example.com');

      expect(res.status).not.toBe(401);
      expect(res.status).toBe(204);
    });
  });

  describe('the real request', () => {
    it('carries allow-origin for an allowed origin', async () => {
      const store = await insertStore();
      const res = await request(buildApp())
        .post('/v1/quotes')
        .set(PUBLIC_KEY_HEADER, store.publicKey)
        .set('Origin', 'https://example.com')
        .send(validBody);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://example.com');
      expect(res.headers['vary']).toContain('Origin');
    });

    it('sends no allow-origin for a domain the store has not listed', async () => {
      const store = await insertStore();
      const res = await request(buildApp())
        .post('/v1/quotes')
        .set(PUBLIC_KEY_HEADER, store.publicKey)
        .set('Origin', 'https://nobody.test')
        .send(validBody);

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('hostSuffixes', () => {
  it('lists the host and every whole-label suffix', () => {
    expect(hostSuffixes('www.shop.example.com')).toEqual([
      'www.shop.example.com',
      'shop.example.com',
      'example.com',
      'com',
    ]);
  });

  it('returns just the host when there are no dots', () => {
    expect(hostSuffixes('localhost')).toEqual(['localhost']);
  });
});
