// npm run demo:reset — removes the seeded stores and "Demo Gadgets" with everything
// that points at them, then seeds again. The shop's own orders are cleared separately,
// from demo-store.

import 'dotenv/config';

import { createDb } from '../src/db';
import { assertLocalDatabase, DEMO_STORE_NAME, removeDemoData, seedDemo } from './demoData';

async function main() {
  const db = createDb(assertLocalDatabase(process.env.DATABASE_URL));
  const removed = await removeDemoData(db);
  console.log(
    `Removed ${removed.stores} stores (seeded and "${DEMO_STORE_NAME}") and ${removed.policies} policies.`,
  );
  const seeded = await seedDemo(db);
  console.log(`Seeded ${seeded.stores} stores and ${seeded.policies} policies.`);
  await (db.$client as { end(): Promise<void> }).end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
