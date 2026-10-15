import 'dotenv/config';

import { assertConfig } from './config';
import { createApp } from './app';
import { createDb } from './db';
import { fakeInsureongoClient } from './lib/insureongo';
import { startIssuanceTimer } from './lib/issuance/worker';


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
const app = createApp(db, insureongo);

// Webhooks start the issuance worker straight away; this also retries events left behind.
startIssuanceTimer(db, insureongo);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
