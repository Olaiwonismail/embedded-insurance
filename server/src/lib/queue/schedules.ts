// Decides when the background jobs run. The job functions themselves know nothing
// about queues or clocks, so this is the only file that changes if the schedule does.

import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';

import { Db } from '../../db';
import { EmailSender } from '../email';
import { weekBoundaryAtOrBefore } from '../lagos';
import { runQuoteCleanup } from '../quotes/cleanup';
import { runWeeklySettlement } from '../settlement/weekly';
import { queuePrefix } from './connection';
import { IssuanceJob, queueStuckEvents } from './issuance';

export const SCHEDULES_QUEUE = 'schedules';

export const TIMEZONE = 'Africa/Lagos';

export const WEEKLY_SETTLEMENT = 'weekly-settlement';
export const QUOTE_CLEANUP = 'quote-cleanup';
export const ISSUANCE_SWEEP = 'issuance-sweep';

// Friday 08:00, daily 03:00, and a sweep every 10 minutes, all Lagos time.
export const SCHEDULES = [
  { name: WEEKLY_SETTLEMENT, pattern: '0 8 * * 5' },
  { name: QUOTE_CLEANUP, pattern: '0 3 * * *' },
  { name: ISSUANCE_SWEEP, pattern: '*/10 * * * *' },
] as const;

export function createSchedulesQueue(connection: Redis): Queue {
  return new Queue(SCHEDULES_QUEUE, {
    connection,
    prefix: queuePrefix(),
    // A missed run is picked up by the next one, so there is no point retrying for long.
    defaultJobOptions: { attempts: 1, removeOnComplete: { age: 7 * 24 * 60 * 60 } },
  });
}

export async function registerSchedules(queue: Queue): Promise<void> {
  for (const { name, pattern } of SCHEDULES) {
    await queue.upsertJobScheduler(name, { pattern, tz: TIMEZONE }, { name });
  }
}

export function createSchedulesWorker(
  db: Db,
  sender: EmailSender,
  issuanceQueue: Queue<IssuanceJob>,
  connection: Redis,
): Worker {
  return new Worker(
    SCHEDULES_QUEUE,
    async (job) => {
      switch (job.name) {
        case WEEKLY_SETTLEMENT:
          // Bill the week that has just ended.
          await runWeeklySettlement(db, sender, weekBoundaryAtOrBefore(new Date()));
          return;
        case QUOTE_CLEANUP:
          await runQuoteCleanup(db, new Date());
          return;
        case ISSUANCE_SWEEP:
          await queueStuckEvents(db, issuanceQueue);
          return;
        default:
          throw new Error(`Unknown scheduled job: ${job.name}`);
      }
    },
    { connection, prefix: queuePrefix(), concurrency: 1 },
  );
}

// Run once at startup, so a Friday or a night the server was down is still covered.
export async function runSchedulesOnce(queue: Queue): Promise<void> {
  await queue.add(WEEKLY_SETTLEMENT, {});
  await queue.add(QUOTE_CLEANUP, {});
  await queue.add(ISSUANCE_SWEEP, {});
}
