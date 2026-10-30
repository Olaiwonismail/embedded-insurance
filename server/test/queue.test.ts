import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDb } from '../src/db';
import {
  customersTable,
  policiesTable,
  quotesTable,
  settlementsTable,
  storesTable,
  webhookEventsTable,
} from '../src/db/schema';
import { generatePublicKey, generateSecretKey, hashSecretKey } from '../src/lib/keys';
import { encryptSecret } from '../src/lib/secrets';
import { InsureongoClient, fakeInsureongoClient } from '../src/lib/insureongo';
import { createRedis } from '../src/lib/queue/connection';
import {
  CONCURRENCY,
  FIRST_BACKOFF_MS,
  MAX_ATTEMPTS,
  createIssuanceQueue,
  createIssuanceWorker,
  enqueueIssuance,
  jobIdFor,
  queueStuckEvents,
} from '../src/lib/queue/issuance';
import {
  ISSUANCE_SWEEP,
  QUOTE_CLEANUP,
  SCHEDULES,
  TIMEZONE,
  WEEKLY_SETTLEMENT,
  createSchedulesQueue,
  registerSchedules,
} from '../src/lib/queue/schedules';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

let connection: Redis;
let queues: Queue[] = [];
let workers: Worker[] = [];

// Each test gets its own key prefix and removes only its own keys afterwards, so a
// shared Redis is never flushed.
function useOwnPrefix(): void {
  counter += 1;
  process.env.REDIS_PREFIX = `test-${process.pid}-${Date.now()}-${counter}`;
}

async function closeEverything(): Promise<void> {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  // obliterate removes this queue's keys only, unlike flushdb.
  await Promise.allSettled(queues.map((queue) => queue.obliterate({ force: true })));
  await Promise.allSettled(queues.map((queue) => queue.close()));
  workers = [];
  queues = [];
  await connection.quit();
}

let counter = 0;

async function insertStore() {
  counter += 1;
  const [store] = await db
    .insert(storesTable)
    .values({
      name: `Queue Store ${counter}`,
      platform: 'custom',
      publicKey: generatePublicKey(),
      secretKeyHash: hashSecretKey(generateSecretKey()),
      webhookSecret: encryptSecret('whsec_test'),
      allowedDomains: ['example.com'],
      enabledCategories: ['phones'],
      commissionRate: '0.1000',
      billingEmail: `billing${counter}@example.com`,
      status: 'active',
    })
    .returning();
  return store;
}

async function insertQuote(storeId: number) {
  counter += 1;
  const [quote] = await db
    .insert(quotesTable)
    .values({
      storeId,
      itemName: 'iPhone 15',
      itemCategory: 'phones',
      itemPrice: '900000.00',
      itemCondition: 'new',
      insureongoQuoteId: `iog-${counter}`,
      insurerName: 'Acme Insurance',
      planName: 'Screen Protect',
      premium: '54000.00',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning();
  return quote;
}

async function insertEvent(storeId: number, quoteId: number, receivedAt?: Date) {
  counter += 1;
  const [event] = await db
    .insert(webhookEventsTable)
    .values({
      storeId,
      eventId: `evt-${counter}`,
      type: 'order.paid',
      payload: {
        eventId: `evt-${counter}`,
        type: 'order.paid',
        quoteId,
        orderRef: `ORDER-${counter}`,
        customer: { name: 'Buyer', email: `buyer${counter}@example.com` },
      },
      status: 'received',
      ...(receivedAt ? { receivedAt } : {}),
    })
    .returning();
  return event;
}

function getEvent(id: number) {
  return db
    .select()
    .from(webhookEventsTable)
    .where(eq(webhookEventsTable.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

// Fails the first `failures` calls, then behaves like the fake client.
function flakyClient(failures: number): InsureongoClient & { calls: number } {
  return {
    calls: 0,
    getQuotes: fakeInsureongoClient.getQuotes,
    async issuePolicy(input) {
      this.calls += 1;
      if (this.calls <= failures) throw new Error('insureOnGo unavailable');
      return fakeInsureongoClient.issuePolicy(input);
    },
  } as InsureongoClient & { calls: number };
}

function alwaysFailing(): InsureongoClient & { calls: number } {
  return {
    calls: 0,
    getQuotes: fakeInsureongoClient.getQuotes,
    async issuePolicy() {
      this.calls += 1;
      throw new Error('insureOnGo unavailable');
    },
  } as InsureongoClient & { calls: number };
}

// Retries with no waiting, so a 10-attempt test does not take ten minutes.
function fastWorker(client: InsureongoClient) {
  const worker = createIssuanceWorker(db, client, connection);
  workers.push(worker);
  return worker;
}

function track<T extends Queue>(queue: T): T {
  queues.push(queue);
  return queue;
}

describe('the issuance queue', () => {
  beforeEach(async () => {
    useOwnPrefix();
    connection = createRedis();

    await db.execute(sql`truncate table ${policiesTable} restart identity cascade`);
    await db.execute(sql`truncate table ${settlementsTable} restart identity cascade`);
    await db.execute(sql`truncate table ${webhookEventsTable} restart identity cascade`);
    await db.execute(sql`truncate table ${quotesTable} restart identity cascade`);
    await db.execute(sql`truncate table ${customersTable} restart identity cascade`);
    await db.execute(sql`truncate table ${storesTable} restart identity cascade`);
  });

  afterEach(closeEverything);

  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  it('adds one job per saved event and refuses a duplicate', async () => {
    const queue = track(createIssuanceQueue(connection));
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, quote.id);

    await enqueueIssuance(queue, event.id);
    await enqueueIssuance(queue, event.id);

    expect(await queue.getWaitingCount()).toBe(1);
    expect(await queue.getJob(jobIdFor(event.id))).toBeDefined();
  });

  it('issues one policy when insureOnGo fails three times then succeeds', async () => {
    const queue = track(createIssuanceQueue(connection));
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, quote.id);
    const client = flakyClient(3);

    // Override the long backoff so the test does not wait minutes.
    await queue.add(
      'issue',
      { eventId: event.id },
      { jobId: jobIdFor(event.id), attempts: MAX_ATTEMPTS, backoff: { type: 'fixed', delay: 10 } },
    );
    fastWorker(client);

    await vi.waitFor(
      async () => {
        expect((await getEvent(event.id)).status).toBe('processed');
      },
      { timeout: 20_000, interval: 100 },
    );

    expect(client.calls).toBe(4);
    expect(await db.select().from(policiesTable)).toHaveLength(1);
  });

  it('tries ten times then marks the event failed with a reason', async () => {
    const queue = track(createIssuanceQueue(connection));
    const store = await insertStore();
    const quote = await insertQuote(store.id);
    const event = await insertEvent(store.id, quote.id);
    const client = alwaysFailing();

    await queue.add(
      'issue',
      { eventId: event.id },
      { jobId: jobIdFor(event.id), attempts: MAX_ATTEMPTS, backoff: { type: 'fixed', delay: 10 } },
    );
    fastWorker(client);

    await vi.waitFor(
      async () => {
        expect((await getEvent(event.id)).status).toBe('failed');
      },
      { timeout: 30_000, interval: 100 },
    );

    const saved = await getEvent(event.id);
    expect(client.calls).toBe(MAX_ATTEMPTS);
    expect(saved.error).toContain(`gave up after ${MAX_ATTEMPTS} tries`);
    expect(await db.select().from(policiesTable)).toHaveLength(0);
  });

  it('runs up to five jobs at once', () => {
    expect(CONCURRENCY).toBe(5);
    expect(FIRST_BACKOFF_MS).toBe(60_000);
  });

  describe('the sweep', () => {
    it('queues an event left received with no job', async () => {
      const queue = track(createIssuanceQueue(connection));
      const store = await insertStore();
      const quote = await insertQuote(store.id);
      const old = new Date(Date.now() - 10 * 60 * 1000);
      const event = await insertEvent(store.id, quote.id, old);

      expect(await queueStuckEvents(db, queue)).toBe(1);
      expect(await queue.getJob(jobIdFor(event.id))).toBeDefined();
    });

    it('leaves a freshly received event alone', async () => {
      const queue = track(createIssuanceQueue(connection));
      const store = await insertStore();
      const quote = await insertQuote(store.id);
      await insertEvent(store.id, quote.id);

      expect(await queueStuckEvents(db, queue)).toBe(0);
      expect(await queue.getWaitingCount()).toBe(0);
    });

    it('does not queue an event a second time', async () => {
      const queue = track(createIssuanceQueue(connection));
      const store = await insertStore();
      const quote = await insertQuote(store.id);
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await insertEvent(store.id, quote.id, old);

      await queueStuckEvents(db, queue);
      await queueStuckEvents(db, queue);

      expect(await queue.getWaitingCount()).toBe(1);
    });
  });
});

describe('the schedules', () => {
  beforeEach(() => {
    useOwnPrefix();
    connection = createRedis();
  });

  afterEach(closeEverything);

  it('registers the weekly bill, the cleanup and the sweep on Lagos time', async () => {
    const queue = track(createSchedulesQueue(connection)) as Queue;
    await registerSchedules(queue);

    const registered = await queue.getJobSchedulers();
    const byName = new Map(registered.map((scheduler) => [scheduler.key, scheduler]));

    expect(byName.get(WEEKLY_SETTLEMENT)?.pattern).toBe('0 8 * * 5');
    expect(byName.get(QUOTE_CLEANUP)?.pattern).toBe('0 3 * * *');
    expect(byName.get(ISSUANCE_SWEEP)?.pattern).toBe('*/10 * * * *');
    for (const scheduler of registered) {
      expect(scheduler.tz).toBe('Africa/Lagos');
    }
  });

  it('names Friday 08:00 and daily 03:00 Lagos', () => {
    expect(TIMEZONE).toBe('Africa/Lagos');
    expect(SCHEDULES.map((schedule) => schedule.pattern)).toEqual([
      '0 8 * * 5',
      '0 3 * * *',
      '*/10 * * * *',
    ]);
  });
});
