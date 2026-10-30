import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';

import { Db } from '../db';

// 200 only when the database answers, so a load balancer takes this instance out of
// service instead of sending it traffic it cannot serve.
export function createHealthRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ status: 'ok', database: 'up' });
    } catch (err: any) {
      // Never log err.message: driver errors embed connection details.
      console.error('Health check failed:', err?.name, err?.code ?? err?.cause?.code ?? '');
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });

  return router;
}
