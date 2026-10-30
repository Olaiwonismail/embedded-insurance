import { Router, Request, Response, NextFunction } from 'express';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { Db } from '../db';
import { policiesTable, storesTable } from '../db/schema';
import { storeColumnsWithoutSecrets } from '../db/storeColumns';
import { requireAdmin } from '../middleware/adminAuth';
import { EmailSender } from '../lib/email';
import { lagosDate, previousWeekBoundary } from '../lib/lagos';
import { runWeeklySettlement } from '../lib/settlement/weekly';

const MAX_INT = 2_147_483_647;

// Matches the merchant dashboard: paid policies count, unpaid and cancelled ones do not.
const SOLD = ['active', 'expired'];

// Store ids are positive integers; anything else is a 400, not a database error.
function parseStoreId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_INT ? id : null;
}

export function createAdminStoresRouter(db: Db, sender: EmailSender): Router {
  const router = Router();
  router.use(requireAdmin());

  const isSold = inArray(policiesTable.status, SOLD);

  // Same shape as the merchant dashboard's own totals, widened to every store.
  // Money stays a string; counts are numbers.
  const soldTotals = {
    policiesSold: sql<number>`count(*) filter (where ${isSold})::int`,
    pendingPolicies: sql<number>`count(*) filter (where ${policiesTable.status} = 'pending')::int`,
    premiumTotal: sql<string>`coalesce(sum(${policiesTable.premium}) filter (where ${isSold}), 0)::numeric(14, 2)::text`,
    commissionTotal: sql<string>`coalesce(sum(${policiesTable.commissionAmount}) filter (where ${isSold}), 0)::numeric(14, 2)::text`,
  };

  router.get('/overview', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [[totals], byStore, [storeCounts]] = await Promise.all([
        db.select(soldTotals).from(policiesTable),

        db
          .select({
            id: storesTable.id,
            name: storesTable.name,
            status: storesTable.status,
            ...soldTotals,
          })
          .from(storesTable)
          .leftJoin(policiesTable, eq(policiesTable.storeId, storesTable.id))
          .groupBy(storesTable.id, storesTable.name, storesTable.status)
          .orderBy(asc(storesTable.id)),

        db
          .select({
            stores: sql<number>`count(*)::int`,
            activeStores: sql<number>`count(*) filter (where ${storesTable.status} = 'active')::int`,
            pendingStores: sql<number>`count(*) filter (where ${storesTable.status} = 'pending')::int`,
          })
          .from(storesTable),
      ]);

      res.json({ totals: { ...storeCounts, ...totals }, stores: byStore });
    } catch (err) {
      next(err);
    }
  });

  // Bills everything unbilled up to now, rather than up to the last Friday the
  // schedule would use: a demo's policies are minutes old, so a week that already
  // closed would not include them. Running it twice is safe, because the job stamps
  // each policy with its settlementId.
  router.post('/settlements/run', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const periodEnd = new Date();
      const result = await runWeeklySettlement(db, sender, periodEnd);

      res.json({
        ...result,
        periodStart: lagosDate(previousWeekBoundary(periodEnd)),
        periodEnd: lagosDate(periodEnd),
      });
    } catch (err) {
      next(err);
    }
  });

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
