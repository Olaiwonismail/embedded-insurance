// Policy issuance as a BullMQ queue.
//
// A failed insureOnGo call used to retry every 30 seconds forever. Now it retries a set
// number of times, waiting longer each time, and then the event is marked failed.

import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { and, eq, lt, sql } from 'drizzle-orm';

import { Db } from '../../db';
import { storesTable, webhookEventsTable } from '../../db/schema';
import { InsureongoClient } from '../insureongo';
import { reportError } from '../errors';
import { paidOrderCondition, processWebhookEvent } from '../issuance/worker';
import { queuePrefix } from './connection';

export const ISSUANCE_QUEUE = 'issuance';

export const MAX_ATTEMPTS = 10;
export const FIRST_BACKOFF_MS = 60_000;
export const CONCURRENCY = 5;

// Only sweep up events older than this, so one being worked on right now is left alone.
export const SWEEP_OLDER_THAN_MS = 5 * 60 * 1000;

export interface IssuanceJob {
  eventId: number;
}

// The webhook_events row id is the job id, so the same event is never queued twice.
export function jobIdFor(eventId: number): string {
  return `event-${eventId}`;
}

export function createIssuanceQueue(connection: Redis): Queue<IssuanceJob> {
  return new Queue<IssuanceJob>(ISSUANCE_QUEUE, {
    connection,
    prefix: queuePrefix(),
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: FIRST_BACKOFF_MS },
      removeOnComplete: { age: 24 * 60 * 60 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
}

export async function enqueueIssuance(queue: Queue<IssuanceJob>, eventId: number): Promise<void> {
  await queue.add('issue', { eventId }, { jobId: jobIdFor(eventId) });
}

export async function markEventFailed(db: Db, eventId: number, reason: string): Promise<void> {
  await db
    .update(webhookEventsTable)
    .set({ status: 'failed', error: reason, processedAt: sql`now()` })
    .where(eq(webhookEventsTable.id, eventId));
}

export function createIssuanceWorker(
  db: Db,
  client: InsureongoClient,
  connection: Redis,
): Worker<IssuanceJob> {
  const worker = new Worker<IssuanceJob>(
    ISSUANCE_QUEUE,
    (job) => processWebhookEvent(db, client, job.data.eventId),
    { connection, prefix: queuePrefix(), concurrency: CONCURRENCY },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    // Never log err.message: driver errors embed query params (customer details).
    const label = err?.name ?? 'Error';

    if ((job.attemptsMade ?? 0) < MAX_ATTEMPTS) {
      console.error('Policy issuance attempt failed:', job.data.eventId, label);
      return;
    }

    reportError(err, { eventId: job.data.eventId, tries: MAX_ATTEMPTS });

    void markEventFailed(db, job.data.eventId, `gave up after ${MAX_ATTEMPTS} tries: ${label}`)
      .catch((writeErr: { name?: string }) =>
        console.error('Could not mark event failed:', job.data.eventId, writeErr?.name),
      );
  });

  return worker;
}

// Queues any paid-order event still "received" after SWEEP_OLDER_THAN_MS, covering an
// event whose job was never added or was lost. The job id stops duplicates, so running
// this often is harmless.
export async function queueStuckEvents(db: Db, queue: Queue<IssuanceJob>): Promise<number> {
  const cutoff = new Date(Date.now() - SWEEP_OLDER_THAN_MS);

  const stuck = await db
    .select({ id: webhookEventsTable.id })
    .from(webhookEventsTable)
    .innerJoin(storesTable, eq(storesTable.id, webhookEventsTable.storeId))
    .where(
      and(
        eq(webhookEventsTable.status, 'received'),
        lt(webhookEventsTable.receivedAt, cutoff),
        paidOrderCondition(),
      ),
    );

  for (const event of stuck) {
    await enqueueIssuance(queue, event.id);
  }

  return stuck.length;
}
