import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';

export type Db = NodePgDatabase;

export function createDb(connectionString: string): Db {
  return drizzle(connectionString);
}
