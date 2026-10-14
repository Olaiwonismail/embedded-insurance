import { Router, Request, Response, NextFunction } from 'express';
import { and, desc, eq, ne } from 'drizzle-orm';

import { Db } from '../db';
import { storesTable } from '../db/schema';
import { storeColumnsWithoutSecrets } from '../db/storeColumns';
import { requireAdmin } from '../middleware/adminAuth';

const MAX_INT = 2_147_483_647;

// Store ids are positive integers; anything else is a 400, not a database error.
function parseStoreId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_INT ? id : null;
}

export function createAdminStoresRouter(db: Db): Router {
  const router = Router();
  router.use(requireAdmin());

  async function storeExists(id: number): Promise<boolean> {
    const [row] = await db
      .select({ id: storesTable.id })
      .from(storesTable)
      .where(eq(storesTable.id, id))
      .limit(1);
    return Boolean(row);
  }

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stores = await db
        .select({
          id: storesTable.id,
          name: storesTable.name,
          platform: storesTable.platform,
          status: storesTable.status,
          allowedDomains: storesTable.allowedDomains,
          enabledCategories: storesTable.enabledCategories,
          createdAt: storesTable.createdAt,
        })
        .from(storesTable)
        .orderBy(desc(storesTable.createdAt), desc(storesTable.id));
      res.json({ stores });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    const id = parseStoreId(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Store id must be a positive whole number' });
      return;
    }
    try {
      const [store] = await db
        .select(storeColumnsWithoutSecrets)
        .from(storesTable)
        .where(eq(storesTable.id, id))
        .limit(1);
      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }
      res.json({ store });
    } catch (err) {
      next(err);
    }
  });

  // Status changes are one conditional UPDATE, so two admins clicking at once
  // cannot both succeed from a stale state.
  router.post(
    '/:id/approve',
    async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
      const id = parseStoreId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Store id must be a positive whole number' });
        return;
      }
      try {
        const [store] = await db
          .update(storesTable)
          .set({ status: 'active' })
          .where(and(eq(storesTable.id, id), eq(storesTable.status, 'pending')))
          .returning(storeColumnsWithoutSecrets);
        if (store) {
          res.json({ store });
        } else if (await storeExists(id)) {
          res.status(409).json({ error: 'Only pending stores can be approved' });
        } else {
          res.status(404).json({ error: 'Store not found' });
        }
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/:id/suspend',
    async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
      const id = parseStoreId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'Store id must be a positive whole number' });
        return;
      }
      try {
        const [store] = await db
          .update(storesTable)
          .set({ status: 'suspended' })
          .where(and(eq(storesTable.id, id), ne(storesTable.status, 'suspended')))
          .returning(storeColumnsWithoutSecrets);
        if (store) {
          res.json({ store });
        } else if (await storeExists(id)) {
          res.status(409).json({ error: 'Store is already suspended' });
        } else {
          res.status(404).json({ error: 'Store not found' });
        }
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
