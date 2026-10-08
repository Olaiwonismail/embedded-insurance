import 'dotenv/config';

import { assertConfig } from './config';
import { createApp } from './app';
import { createDb } from './db';


// Refuse to start without a valid ENCRYPTION_KEY and DEFAULT_COMMISSION_RATE.
try {
  assertConfig();
} catch (err) {
  console.error(`Refusing to start: ${(err as Error).message}`);
  process.exit(1);
}

const port = process.env.PORT;
const app = createApp(createDb(process.env.DATABASE_URL!));

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
