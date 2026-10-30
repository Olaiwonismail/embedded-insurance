import crypto from 'crypto';
import express from 'express';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDb } from '../src/db';
import { storesTable, webhookEventsTable } from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { createWebhooksRouter } from '../src/routes/webhooks';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

// The receiver alone, without the issuance worker, so saved events stay "received".
const app = express();
app.use('/v1/webhooks', createWebhooksRouter(db));

const KNOWN_SECRET = 'whsec_known_test_secret_abc123';

async function insertStore(overrides: Partial<typeof storesTable.$inferInsert> = {}) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: 'Test Store',
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret(KNOWN_SECRET),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: `billing-${Date.now()}-${Math.random()}@example.com`,
      status: 'active',
      ...overrides,
    })
    .returning();
  return store;
}

function signCustom(body: string, secret: string = KNOWN_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function customHeaders(signature: string, timestamp = Math.floor(Date.now() / 1000)) {
  return {
    'Content-Type': 'application/json',
    'X-InsureOnGo-Signature': signature,
    'X-InsureOnGo-Timestamp': String(timestamp),
  };
}

describe('POST /v1/webhooks/:platform/:publicKey', () => {
  beforeEach(async () => {
    await db.execute(sql`truncate table ${webhookEventsTable} restart identity cascade`);
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  // =========================================================================
  // Common Tests
  // =========================================================================
  describe('Common', () => {
    it('returns 404 for an unknown :platform', async () => {
      const store = await insertStore();
      const res = await request(app)
        .post(`/v1/webhooks/unknown_platform/${store.publicKey}`)
        .send('{}');
      expect(res.status).toBe(404);
    });

    it('returns 404 for an unknown :publicKey', async () => {
      const res = await request(app)
        .post('/v1/webhooks/custom/non_existent_public_key')
        .send('{}');
      expect(res.status).toBe(404);
    });

    it('returns 403 when the store status is not active (pending)', async () => {
      const store = await insertStore({ status: 'pending' });
      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .send('{}');
      expect(res.status).toBe(403);
    });

    it('returns 403 when the store status is suspended', async () => {
      const store = await insertStore({ status: 'suspended' });
      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .send('{}');
      expect(res.status).toBe(403);
    });

    it('returns 200 both times and inserts only one row when the same body is sent twice (idempotency)', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({
        eventId: 'evt_repeat_001',
        type: 'order.paid',
        orderRef: 'ord_999',
        quoteId: 1,
        customer: { name: 'Jane Doe', email: 'jane@example.com' },
      });
      const signature = signCustom(payloadStr);
      const timestamp = Math.floor(Date.now() / 1000);

      const res1 = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set(customHeaders(signature, timestamp))
        .send(payloadStr);

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set(customHeaders(signature, timestamp))
        .send(payloadStr);

      expect(res2.status).toBe(200);

      const rows = await db
        .select()
        .from(webhookEventsTable)
        .where(eq(webhookEventsTable.storeId, store.id));

      expect(rows).toHaveLength(1);
      expect(rows[0].eventId).toBe('evt_repeat_001');
    });
  });

  // =========================================================================
  // Custom Tests
  // =========================================================================
  describe('Custom', () => {
    const validCustomBody = {
      eventId: 'cust_evt_2001',
      type: 'order.paid',
      orderRef: 'ord_998877',
      quoteId: 42,
      customer: {
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1234567890',
      },
    };

    it('returns 200 for a valid signed body with a current timestamp', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify(validCustomBody);
      const signature = signCustom(payloadStr);
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(currentTimestamp))
        .send(payloadStr);

      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(webhookEventsTable)
        .where(eq(webhookEventsTable.storeId, store.id));

      expect(row).toBeDefined();
      expect(row.eventId).toBe('cust_evt_2001');
      expect(row.type).toBe('order.paid');
      expect(row.payload).toEqual(validCustomBody);
    });

    it('returns 401 and inserts nothing for a wrong signature', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify(validCustomBody);
      const wrongSignature = signCustom(payloadStr, 'bad_secret');
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', wrongSignature)
        .set('X-InsureOnGo-Timestamp', String(currentTimestamp))
        .send(payloadStr);

      expect(res.status).toBe(401);

      const rows = await db.select().from(webhookEventsTable);
      expect(rows).toHaveLength(0);
    });

    it('returns 401 for a timestamp more than 5 minutes old (301 seconds ago)', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify(validCustomBody);
      const signature = signCustom(payloadStr);
      const oldTimestamp = Math.floor(Date.now() / 1000) - 301;

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(oldTimestamp))
        .send(payloadStr);

      expect(res.status).toBe(401);

      const rows = await db.select().from(webhookEventsTable);
      expect(rows).toHaveLength(0);
    });

    it('returns 401 for a timestamp more than 5 minutes in the future', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify(validCustomBody);
      const signature = signCustom(payloadStr);
      const futureTimestamp = Math.floor(Date.now() / 1000) + 301;

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(futureTimestamp))
        .send(payloadStr);

      expect(res.status).toBe(401);
    });

    it('returns 401 for a missing X-InsureOnGo-Timestamp', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify(validCustomBody);
      const signature = signCustom(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .send(payloadStr);

      expect(res.status).toBe(401);
    });

    it('returns 401 for a non-numeric X-InsureOnGo-Timestamp', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify(validCustomBody);
      const signature = signCustom(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', 'not-a-timestamp')
        .send(payloadStr);

      expect(res.status).toBe(401);
    });

    it("returns 400 for a body that isn't valid JSON", async () => {
      const store = await insertStore();
      const malformedBody = 'this is not valid json {{{';
      const signature = signCustom(malformedBody);
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(currentTimestamp))
        .send(malformedBody);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Request body is not valid JSON');
    });

    it('returns 400 for a body missing eventId', async () => {
      const store = await insertStore();
      const { eventId, ...bodyWithoutEventId } = validCustomBody;
      const payloadStr = JSON.stringify(bodyWithoutEventId);
      const signature = signCustom(payloadStr);
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(currentTimestamp))
        .send(payloadStr);

      expect(res.status).toBe(400);
    });

    it('returns 400 for a body missing type', async () => {
      const store = await insertStore();
      const { type, ...bodyWithoutType } = validCustomBody;
      const payloadStr = JSON.stringify(bodyWithoutType);
      const signature = signCustom(payloadStr);
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const res = await request(app)
        .post(`/v1/webhooks/custom/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-InsureOnGo-Signature', signature)
        .set('X-InsureOnGo-Timestamp', String(currentTimestamp))
        .send(payloadStr);

      expect(res.status).toBe(400);
    });
  });
});
