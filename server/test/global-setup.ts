import { execSync } from 'child_process';
import path from 'path';

// Separate database for tests; it is truncated between test cases.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:test@localhost:55432/insurance_test';

// Bring the test database up to date with src/db/schema.ts before any test runs.
export default function setup() {
  execSync('npx drizzle-kit push --force', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
