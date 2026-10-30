import express, { Express } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createDb, Db } from '../src/db';
import { createHealthRouter } from '../src/routes/health';
import { TEST_DATABASE_URL } from './global-setup';

const db = createDb(TEST_DATABASE_URL);

function buildApp(using: Db): Express {
  const app = express();
  app.use('/health', createHealthRouter(using));
  return app;
}

describe('GET /health', () => {
  afterAll(async () => {
    await (db.$client as { end(): Promise<void> }).end();
  });

  it('answers 200 when the database answers', async () => {
    const res = await request(buildApp(db)).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('answers 503 when the database does not', async () => {
    // A port with nothing on it, so connecting fails rather than hanging.
    const broken = createDb('postgres://postgres:test@127.0.0.1:1/none');

    const res = await request(buildApp(broken)).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'down' });
  });
});
