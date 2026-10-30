// npm run demo:seed — two active stores with billed policies, so the admin list opens
// populated. Does nothing if the seed is already there.

import 'dotenv/config';

import { createDb } from '../src/db';
import { assertLocalDatabase, seedDemo } from './demoData';

async function main() {
  const db = createDb(assertLocalDatabase(process.env.DATABASE_URL));
  const result = await seedDemo(db);
  if (result.skipped) {
    console.log('Demo seed already present; nothing added. Run demo:reset to start over.');
  } else {
    console.log(`Seeded ${result.stores} stores and ${result.policies} policies.`);
  }
  await (db.$client as { end(): Promise<void> }).end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
