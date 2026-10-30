import 'dotenv/config';

import { startErrorReporting } from './lib/errors';
import { assertConfig } from './config';
import { createApp } from './app';
import { createDb } from './db';
import { fakeInsureongoClient } from './lib/insureongo';
import { logOnlyEmailSender } from './lib/email';
import { createRedis } from './lib/queue/connection';
import { createIssuanceQueue, createIssuanceWorker, enqueueIssuance } from './lib/queue/issuance';
import {
  createSchedulesQueue,
  createSchedulesWorker,
  registerSchedules,
  runSchedulesOnce,
} from './lib/queue/schedules';

// Must come first, so a crash during setup is still reported.
if (!startErrorReporting()) {
  console.log('SENTRY_DSN is not set; errors are logged only.');
}

// Refuse to start without a valid ENCRYPTION_KEY and DEFAULT_COMMISSION_RATE.
try {
  assertConfig();
} catch (err) {
  console.error(`Refusing to start: ${(err as Error).message}`);
  process.exit(1);
}

const port = process.env.PORT;
const db = createDb(process.env.DATABASE_URL!);
const insureongo = fakeInsureongoClient;

const connection = createRedis();
const issuanceQueue = createIssuanceQueue(connection);
const schedulesQueue = createSchedulesQueue(connection);

const issuanceWorker = createIssuanceWorker(db, insureongo, connection);
const schedulesWorker = createSchedulesWorker(db, logOnlyEmailSender, issuanceQueue, connection);

const app = createApp(db, (eventId) => {
  void enqueueIssuance(issuanceQueue, eventId).catch((err: { name?: string }) =>
    console.error('Could not queue issuance for event:', eventId, err?.name),
  );
});

// Friday 08:00 and 03:00 daily, Lagos time, plus one pass now: a Friday or a night the
// server was down is still covered.
void (async () => {
  try {
    await registerSchedules(schedulesQueue);
    await runSchedulesOnce(schedulesQueue);
  } catch (err: any) {
    console.error('Could not set up schedules:', err?.name);
  }
})();

const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await Promise.allSettled([issuanceWorker.close(), schedulesWorker.close()]);
  await Promise.allSettled([issuanceQueue.close(), schedulesQueue.close()]);
  await connection.quit();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
}
