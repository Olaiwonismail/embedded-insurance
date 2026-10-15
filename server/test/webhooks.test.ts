import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { createDb } from '../src/db';
import { storesTable, webhookEventsTable } from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);
const app = createApp(db);

const KNOWN_SECRET = 'whsec_known_test_secret_abc123';

async function insertStore(overrides: Partial<typeof storesTable.$inferInsert> = {}) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: 'Test Store',
      platform: 'shopify',
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

function signShopify(body: string, secret: string = KNOWN_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function signCustom(body: string, secret: string = KNOWN_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
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
        .post('/v1/webhooks/shopify/non_existent_public_key')
        .send('{}');
      expect(res.status).toBe(404);
    });

    it('returns 403 when the store status is not active (pending)', async () => {
      const store = await insertStore({ status: 'pending' });
      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .send('{}');
      expect(res.status).toBe(403);
    });

    it('returns 403 when the store status is suspended', async () => {
      const store = await insertStore({ status: 'suspended' });
      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .send('{}');
      expect(res.status).toBe(403);
    });

    it('returns 200 and inserts exactly one row for a valid signed body', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ orderId: 12345, total: '99.99' });
      const signature = signShopify(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'wh_shopify_001')
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res.status).toBe(200);

      const rows = await db
        .select()
        .from(webhookEventsTable)
        .where(eq(webhookEventsTable.storeId, store.id));

      expect(rows).toHaveLength(1);
      expect(rows[0].eventId).toBe('wh_shopify_001');
      expect(rows[0].type).toBe('orders/paid');
      expect(rows[0].status).toBe('received');
      expect(rows[0].payload).toEqual({ orderId: 12345, total: '99.99' });
    });

    it('returns 200 both times and inserts only one row when the same body is sent twice (idempotency)', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ orderId: 999 });
      const signature = signShopify(payloadStr);

      const res1 = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'evt_repeat_001')
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'evt_repeat_001')
        .set('X-Shopify-Topic', 'orders/paid')
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
  // Shopify Tests
  // =========================================================================
  describe('Shopify', () => {
    it('returns 200 for a body signed with the right secret and valid headers', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1001, line_items: [] });
      const signature = signShopify(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'shp_evt_1001')
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res.status).toBe(200);
    });

    it('returns 401 and inserts nothing for a body with a wrong X-Shopify-Hmac-Sha256', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1002 });
      const wrongSignature = signShopify(payloadStr, 'wrong_secret_string');

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', wrongSignature)
        .set('X-Shopify-Webhook-Id', 'shp_evt_1002')
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res.status).toBe(401);

      const rows = await db.select().from(webhookEventsTable);
      expect(rows).toHaveLength(0);
    });

    it('returns 401 when X-Shopify-Hmac-Sha256 header is missing', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1003 });

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Webhook-Id', 'shp_evt_1003')
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res.status).toBe(401);
    });

    it('stores type equal to X-Shopify-Topic header', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1004 });
      const signature = signShopify(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'shp_evt_1004')
        .set('X-Shopify-Topic', 'orders/fulfilled')
        .send(payloadStr);

      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(webhookEventsTable)
        .where(eq(webhookEventsTable.eventId, 'shp_evt_1004'));

      expect(row.type).toBe('orders/fulfilled');
    });

    it('stores eventId equal to X-Shopify-Webhook-Id header', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1005 });
      const signature = signShopify(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'custom_webhook_header_id_1005')
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res.status).toBe(200);

      const [row] = await db
        .select()
        .from(webhookEventsTable)
        .where(eq(webhookEventsTable.storeId, store.id));

      expect(row.eventId).toBe('custom_webhook_header_id_1005');
    });

    it('returns 400 when X-Shopify-Webhook-Id is missing', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1006 });
      const signature = signShopify(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Topic', 'orders/paid')
        .send(payloadStr);

      expect(res.status).toBe(400);
    });

    it('returns 400 when X-Shopify-Topic is missing', async () => {
      const store = await insertStore();
      const payloadStr = JSON.stringify({ order_number: 1007 });
      const signature = signShopify(payloadStr);

      const res = await request(app)
        .post(`/v1/webhooks/shopify/${store.publicKey}`)
        .set('Content-Type', 'application/json')
        .set('X-Shopify-Hmac-Sha256', signature)
        .set('X-Shopify-Webhook-Id', 'shp_evt_1007')
        .send(payloadStr);

      expect(res.status).toBe(400);
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
