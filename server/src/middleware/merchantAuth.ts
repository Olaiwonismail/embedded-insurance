import { RequestHandler } from 'express';
import { and, eq, gt } from 'drizzle-orm';

import { Db } from '../db';
import { merchantSessionsTable, storesTable } from '../db/schema';
import { StoreWithoutSecrets, storeColumnsWithoutSecrets } from '../db/storeColumns';
import { hashToken, readSessionToken } from '../lib/sessions';

declare global {
  namespace Express {
    interface Request {
      // The signed-in merchant's store. Set by requireMerchant.
      merchantStore?: StoreWithoutSecrets;
    }
  }
}

// Lets the request through only with a valid, unexpired dashboard session.
export function requireMerchant(db: Db): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (!token) {
        res.status(401).json({ error: 'Sign in to continue' });
        return;
      }

      const [store] = await db
        .select(storeColumnsWithoutSecrets)
        .from(merchantSessionsTable)
        .innerJoin(storesTable, eq(storesTable.id, merchantSessionsTable.storeId))
        .where(
          and(
            eq(merchantSessionsTable.tokenHash, hashToken(token)),
            gt(merchantSessionsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!store) {
        res.status(401).json({ error: 'Your session has ended. Sign in again.' });
        return;
      }

      req.merchantStore = store;
      next();
    } catch (err) {
      next(err);
    }
  };
}
