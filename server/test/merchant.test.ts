import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { createDb } from '../src/db';
import {
  customersTable,
  merchantSessionsTable,
  policiesTable,
  quotesTable,
  settlementsTable,
  storesTable,
  webhookEventsTable,
} from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { hashPassword } from '../src/lib/passwords';
import { encryptSecret } from '../src/lib/secrets';
import { SESSION_COOKIE } from '../src/lib/sessions';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);
const PASSWORD = 'correct horse battery';
let passwordHash: string;

async function insertStore(email: string, withPassword = true) {
  const [store] = await db
    .insert(storesTable)
    .values({
      name: email.split('@')[0],
      platform: 'shopify',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['3chub.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: email,
      passwordHash: withPassword ? passwordHash : null,
    })
    .returning();
  return store;
}

// Policies need a customer and quote behind them.
async function insertPolicy(storeId: number, status: string, premium: string, ref: string) {
  const [customer] = await db
    .insert(customersTable)
    .values({ name: 'Ada', email: 'ada@example.com' })
    .returning();
  const [quote] = await db
    .insert(quotesTable)
    .values({
      storeId,
      itemName: 'Phone',
      itemCategory: 'phones',
      itemPrice: '400000.00',
      itemCondition: 'new',
      insureongoQuoteId: `quote-${ref}`,
      insurerName: 'Insurer',
      planName: 'Device cover',
      premium,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  await db.insert(policiesTable).values({
    quoteId: quote.id,
    storeId,
    customerId: customer.id,
    issuanceKey: `issue-${ref}`,
    orderRef: ref,
    itemName: 'Phone',
    itemCategory: 'phones',
    itemPrice: '400000.00',
    premium,
    commissionAmount: (Number(premium) / 10).toFixed(2),
    status,
  });
}

function login(app: ReturnType<typeof createApp>, email: string, password = PASSWORD) {
  return request(app).post('/v1/merchant/login').send({ email, password });
}

function sessionCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
  return cookie.split(';')[0];
}

describe('merchant dashboard API', () => {
  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    await db.execute(sql`truncate table ${policiesTable}, ${quotesTable}, ${customersTable},
      ${settlementsTable}, ${webhookEventsTable},
      ${merchantSessionsTable}, ${storesTable} restart identity cascade`);
  });

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  describe('POST /login', () => {
    it('signs in with the right email and password, ignoring email case', async () => {
      const store = await insertStore('owner@3chub.com');
      const res = await login(createApp(db), 'OWNER@3chub.com');

      expect(res.status).toBe(200);
      expect(res.body.store.id).toBe(store.id);
      expect(res.body.store).not.toHaveProperty('passwordHash');
      expect(res.body.store).not.toHaveProperty('secretKeyHash');
      expect(sessionCookie(res)).not.toBe('');
      expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    });

    it('stores only a hash of the session token', async () => {
      await insertStore('owner@3chub.com');
      const res = await login(createApp(db), 'owner@3chub.com');
      const token = sessionCookie(res).split('=')[1];

      const rows = await db.select().from(merchantSessionsTable);
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(token);
    });

    it.each([
      ['wrong password', 'owner@3chub.com', 'wrong password!'],
      ['unknown email', 'nobody@3chub.com', PASSWORD],
    ])('returns the same 401 for a %s', async (_case, email, password) => {
      await insertStore('owner@3chub.com');
      const res = await login(createApp(db), email, password);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Email or password is incorrect');
      expect(sessionCookie(res)).toBe('');
    });

    it('returns 401 for a store created before passwords existed', async () => {
      await insertStore('legacy@3chub.com', false);
      const res = await login(createApp(db), 'legacy@3chub.com');
      expect(res.status).toBe(401);
    });

    it('returns 400 when fields are missing', async () => {
      const res = await request(createApp(db)).post('/v1/merchant/login').send({ email: 'a@b.com' });
      expect(res.status).toBe(400);
    });

    it('returns 429 after 10 attempts from one address', async () => {
      const app = createApp(db);
      for (let i = 0; i < 10; i++) {
        expect((await login(app, 'nobody@3chub.com')).status).toBe(401);
      }
      expect((await login(app, 'nobody@3chub.com')).status).toBe(429);
    }, 60_000);
  });

  describe('sessions', () => {
    it('GET /me returns 401 without a session', async () => {
      const res = await request(createApp(db)).get('/v1/merchant/me');
      expect(res.status).toBe(401);
    });

    it('GET /me returns 401 for a made-up token', async () => {
      const res = await request(createApp(db))
        .get('/v1/merchant/me')
        .set('Cookie', `${SESSION_COOKIE}=not-a-real-token`);
      expect(res.status).toBe(401);
    });

    it('GET /me returns 401 once the session has expired', async () => {
      await insertStore('owner@3chub.com');
      const app = createApp(db);
      const cookie = sessionCookie(await login(app, 'owner@3chub.com'));
      await db.update(merchantSessionsTable).set({ expiresAt: new Date(Date.now() - 1000) });

      const res = await request(app).get('/v1/merchant/me').set('Cookie', cookie);
      expect(res.status).toBe(401);
    });

    it('logout ends the session', async () => {
      const store = await insertStore('owner@3chub.com');
      const app = createApp(db);
      const cookie = sessionCookie(await login(app, 'owner@3chub.com'));

      expect((await request(app).get('/v1/merchant/me').set('Cookie', cookie)).body.store.id).toBe(
        store.id,
      );
      const out = await request(app).post('/v1/merchant/logout').set('Cookie', cookie);
      expect(out.status).toBe(204);
      expect((await request(app).get('/v1/merchant/me').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('GET /activity', () => {
    it('returns zeros and empty lists for a new store', async () => {
      await insertStore('owner@3chub.com');
      const app = createApp(db);
      const cookie = sessionCookie(await login(app, 'owner@3chub.com'));

      const res = await request(app).get('/v1/merchant/activity').set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        sales: { policiesSold: 0, pendingPolicies: 0, premiumTotal: '0.00', commissionTotal: '0.00' },
        recentPolicies: [],
        settlements: [],
        webhookEvents: [],
      });
    });

    it('totals sold policies and shows only the signed-in store', async () => {
      const mine = await insertStore('owner@3chub.com');
      const other = await insertStore('other@shop.com');

      await insertPolicy(mine.id, 'active', '20000.00', 'A1');
      await insertPolicy(mine.id, 'expired', '10000.00', 'A2');
      await insertPolicy(mine.id, 'pending', '5000.00', 'A3');
      await insertPolicy(mine.id, 'cancelled', '7000.00', 'A4');
      await insertPolicy(other.id, 'active', '99999.00', 'B1');

      await db.insert(settlementsTable).values([
        { storeId: mine.id, settlementDate: '2026-10-10', policyCount: 2, premiumTotal: '30000.00', commissionTotal: '3000.00' },
        { storeId: other.id, settlementDate: '2026-10-10', policyCount: 1, premiumTotal: '99999.00', commissionTotal: '9999.90' },
      ]);
      await db.insert(webhookEventsTable).values([
        { storeId: mine.id, eventId: 'evt_mine', type: 'orders/paid', payload: { customer: 'secret' } },
        { storeId: other.id, eventId: 'evt_other', type: 'orders/paid', payload: {} },
      ]);

      const app = createApp(db);
      const cookie = sessionCookie(await login(app, 'owner@3chub.com'));
      const res = await request(app).get('/v1/merchant/activity').set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect(res.body.sales).toEqual({
        policiesSold: 2,
        pendingPolicies: 1,
        premiumTotal: '30000.00',
        commissionTotal: '3000.00',
      });
      expect(res.body.recentPolicies.map((p: { orderRef: string }) => p.orderRef).sort()).toEqual([
        'A1',
        'A2',
        'A3',
        'A4',
      ]);
      expect(res.body.settlements).toHaveLength(1);
      expect(res.body.settlements[0].premiumTotal).toBe('30000.00');
      expect(res.body.webhookEvents.map((e: { eventId: string }) => e.eventId)).toEqual(['evt_mine']);
      expect(res.body.webhookEvents[0]).not.toHaveProperty('payload');
    });

    it('returns 401 without a session', async () => {
      const res = await request(createApp(db)).get('/v1/merchant/activity');
      expect(res.status).toBe(401);
    });
  });

  it('deleting a store removes its sessions', async () => {
    const store = await insertStore('owner@3chub.com');
    await login(createApp(db), 'owner@3chub.com');
    await db.delete(storesTable).where(eq(storesTable.id, store.id));
    expect(await db.select().from(merchantSessionsTable)).toHaveLength(0);
  });
});
