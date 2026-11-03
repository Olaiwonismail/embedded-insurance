import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { Db } from '../db';
import { merchantSessionsTable, storesTable } from '../db/schema';
import { storeColumnsWithoutSecrets } from '../db/storeColumns';
import { getDummyHash, verifyPassword } from '../lib/passwords';
import {
  clearSessionCookie,
  hashToken,
  readSessionToken,
  startSession,
} from '../lib/sessions';
import { getStoreActivity } from '../lib/storeActivity';
import { requireMerchant } from '../middleware/merchantAuth';

const loginSchema = z.strictObject({
  email: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

export function createMerchantRouter(db: Db): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  });

  router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Enter your email and password' });
      return;
    }
    const { email, password } = parsed.data;

    try {
      const [account] = await db
        .select({ id: storesTable.id, passwordHash: storesTable.passwordHash })
        .from(storesTable)
        .where(
          and(
            sql`lower(${storesTable.billingEmail}) = lower(${email})`,
            isNotNull(storesTable.passwordHash),
          ),
        )
        .limit(1);

      // Same work and same answer whether the email or the password is wrong.
      const ok = await verifyPassword(password, account?.passwordHash ?? (await getDummyHash()));
      if (!account || !ok) {
        res.status(401).json({ error: 'Email or password is incorrect' });
        return;
      }

      await startSession(db, req, res, account.id);
      const [store] = await db
        .select(storeColumnsWithoutSecrets)
        .from(storesTable)
        .where(eq(storesTable.id, account.id));
      res.json({ store });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = readSessionToken(req);
      if (token) {
        await db
          .delete(merchantSessionsTable)
          .where(eq(merchantSessionsTable.tokenHash, hashToken(token)));
      }
      clearSessionCookie(res);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Everything below needs a signed-in merchant and only ever reads their own store.
  router.use(requireMerchant(db));

  router.get('/me', (req: Request, res: Response) => {
    res.json({ store: req.merchantStore });
  });

  router.get('/activity', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await getStoreActivity(db, req.merchantStore!.id));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
