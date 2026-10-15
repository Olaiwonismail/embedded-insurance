import express, { Express } from 'express';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb } from '../src/db';
import { quotesTable, storesTable } from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { InsureongoClient, InsureongoMatch } from '../src/lib/insureongo';
import { createQuotesRouter } from '../src/routes/quotes';
import { createWidgetAuth, PUBLIC_KEY_HEADER } from '../src/middleware/widgetAuth';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function insertStore(overrides: { enabledCategories?: string[]; status?: string } = {}) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: 'Test Store',
      platform: 'shopify',
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

function stubClient(matches: InsureongoMatch[]): InsureongoClient & { getQuotes: ReturnType<typeof vi.fn> } {
  return { getQuotes: vi.fn().mockResolvedValue(matches), issuePolicy: vi.fn() };
}

function buildApp(client?: InsureongoClient): Express {
  const app = express();
  app.use(express.json());
  app.use('/v1/quotes', createWidgetAuth(db), createQuotesRouter(db, client));
  // Simple error handler so unhandled errors don't crash the test.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

function postQuote(app: Express, publicKey: string, body: Record<string, unknown>) {
  return request(app)
    .post('/v1/quotes')
    .set(PUBLIC_KEY_HEADER, publicKey)
    .set('Origin', 'https://example.com')
    .send(body);
}

const validBody = {
  itemName: 'iPhone 15',
  itemCategory: 'phones',
  itemPrice: 999.99,
  itemCondition: 'new',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /v1/quotes', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${quotesTable} restart identity cascade`);
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  // ---- Validation (400) ----

  describe('validation', () => {
    it('returns 400 when itemName is missing', async () => {
      const store = await insertStore();
      const { itemName, ...body } = validBody;
      const res = await postQuote(buildApp(), store.publicKey, body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemName is empty', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, { ...validBody, itemName: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemName exceeds 255 characters', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, {
        ...validBody,
        itemName: 'x'.repeat(256),
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid itemCategory', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, {
        ...validBody,
        itemCategory: 'smartwatches',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemPrice is zero', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, { ...validBody, itemPrice: 0 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemPrice is negative', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, { ...validBody, itemPrice: -10 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when itemPrice has more than 2 decimal places', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, {
        ...validBody,
        itemPrice: 9.999,
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for an invalid itemCondition', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, {
        ...validBody,
        itemCondition: 'refurbished',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body contains unknown fields', async () => {
      const store = await insertStore();
      const res = await postQuote(buildApp(), store.publicKey, {
        ...validBody,
        unknownField: 'surprise',
      });
      expect(res.status).toBe(400);
    });
  });

  // ---- Category not enabled (204) ----

  describe('category not enabled', () => {
    it('returns 204 and does not call the insureOnGo client', async () => {
      const store = await insertStore({ enabledCategories: ['laptops'] });
      const client = stubClient([]);

      const res = await postQuote(buildApp(client), store.publicKey, {
        ...validBody,
        itemCategory: 'phones', // not in the store's enabled list
      });

      expect(res.status).toBe(204);
      expect(client.getQuotes).not.toHaveBeenCalled();

      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));
      expect(rows).toHaveLength(0);
    });
  });

  // ---- insureOnGo returns empty list (204) ----

  describe('insureOnGo returns no matches', () => {
    it('returns 204 and saves nothing', async () => {
      const store = await insertStore();
      const client = stubClient([]);

      const res = await postQuote(buildApp(client), store.publicKey, validBody);

      expect(res.status).toBe(204);

      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));
      expect(rows).toHaveLength(0);
    });
  });

  // ---- Successful quotes ----

  describe('successful quotes', () => {
    it('returns 200 with one entry when the client returns one match', async () => {
      const store = await insertStore();
      const oneMatch: InsureongoMatch[] = [
        { quoteId: 'q-1', insurerName: 'TestInsurer', planName: 'Basic', premium: '5.00' },
      ];
      const client = stubClient(oneMatch);

      const res = await postQuote(buildApp(client), store.publicKey, validBody);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        insurerName: 'TestInsurer',
        planName: 'Basic',
        premium: '5.00',
      });
      expect(res.body[0].id).toEqual(expect.any(Number));

      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));
      expect(rows).toHaveLength(1);
    });

    it('returns 200 with two entries in the same order using the default fake', async () => {
      const store = await insertStore();
      // Uses the default fake client (no client argument)
      const app = buildApp();

      const res = await postQuote(app, store.publicKey, validBody);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].insurerName).toBe('Acme Insurance');
      expect(res.body[1].insurerName).toBe('Shield Underwriters');

      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));
      expect(rows).toHaveLength(2);
    });

    it('saves the correct storeId on each row', async () => {
      const store = await insertStore();
      await postQuote(buildApp(), store.publicKey, validBody);

      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));
      for (const row of rows) {
        expect(row.storeId).toBe(store.id);
      }
    });

    it('saves status as "offered" on each row', async () => {
      const store = await insertStore();
      await postQuote(buildApp(), store.publicKey, validBody);

      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));
      for (const row of rows) {
        expect(row.status).toBe('offered');
      }
    });

    it('saves expiresAt approximately 30 days from now', async () => {
      const store = await insertStore();
      const before = Date.now();
      await postQuote(buildApp(), store.publicKey, validBody);
      const after = Date.now();

      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const rows = await db.select().from(quotesTable).where(eq(quotesTable.storeId, store.id));

      for (const row of rows) {
        const expiresMs = new Date(row.expiresAt).getTime();
        // Allow a few seconds of tolerance
        expect(expiresMs).toBeGreaterThanOrEqual(before + thirtyDaysMs - 5000);
        expect(expiresMs).toBeLessThanOrEqual(after + thirtyDaysMs + 5000);
      }
    });

    it('saves the premium from each match', async () => {
      const store = await insertStore();
      const matches: InsureongoMatch[] = [
        { quoteId: 'q-a', insurerName: 'A', planName: 'Plan A', premium: '12.34' },
        { quoteId: 'q-b', insurerName: 'B', planName: 'Plan B', premium: '56.78' },
      ];
      const client = stubClient(matches);

      const res = await postQuote(buildApp(client), store.publicKey, validBody);

      expect(res.body[0].premium).toBe('12.34');
      expect(res.body[1].premium).toBe('56.78');

      const rows = await db
        .select()
        .from(quotesTable)
        .where(eq(quotesTable.storeId, store.id));
      const premiums = rows.map((r) => r.premium);
      expect(premiums).toContain('12.34');
      expect(premiums).toContain('56.78');
    });
  });

  // ---- Auth (401) ----

  describe('widget auth', () => {
    it('returns 401 for an unknown public key', async () => {
      const res = await postQuote(buildApp(), generatePublicKey(), validBody);
      expect(res.status).toBe(401);
    });
  });
});
