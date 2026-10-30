import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { Db } from '../db';
import {
  merchantSessionsTable,
  policiesTable,
  settlementsTable,
  storesTable,
  webhookEventsTable,
} from '../db/schema';
import { storeColumnsWithoutSecrets } from '../db/storeColumns';
import { getDummyHash, verifyPassword } from '../lib/passwords';
import {
  clearSessionCookie,
  hashToken,
  readSessionToken,
  startSession,
} from '../lib/sessions';
import { requireMerchant } from '../middleware/merchantAuth';

const RECENT_LIMIT = 10;

// Policies count as sold once paid; cancelled ones and unpaid (pending) ones do not.
const SOLD = ['active', 'expired'];

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
    const storeId = req.merchantStore!.id;
    const isSold = sql`${policiesTable.status} in (${sql.join(
      SOLD.map((s) => sql`${s}`),
      sql`, `,
    )})`;

    try {
      const [[sales], recentPolicies, settlements, webhookEvents] = await Promise.all([
        db
          .select({
            policiesSold: sql<number>`count(*) filter (where ${isSold})::int`,
            pendingPolicies: sql<number>`count(*) filter (where ${policiesTable.status} = 'pending')::int`,
            premiumTotal: sql<string>`coalesce(sum(${policiesTable.premium}) filter (where ${isSold}), 0)::numeric(14, 2)::text`,
            commissionTotal: sql<string>`coalesce(sum(${policiesTable.commissionAmount}) filter (where ${isSold}), 0)::numeric(14, 2)::text`,
          })
          .from(policiesTable)
          .where(eq(policiesTable.storeId, storeId)),

        db
          .select({
            id: policiesTable.id,
            policyNumber: policiesTable.policyNumber,
            orderRef: policiesTable.orderRef,
            itemName: policiesTable.itemName,
            itemCategory: policiesTable.itemCategory,
            itemPrice: policiesTable.itemPrice,
            premium: policiesTable.premium,
            commissionAmount: policiesTable.commissionAmount,
            status: policiesTable.status,
            createdAt: policiesTable.createdAt,
          })
          .from(policiesTable)
          .where(eq(policiesTable.storeId, storeId))
          .orderBy(desc(policiesTable.createdAt), desc(policiesTable.id))
          .limit(RECENT_LIMIT),

        db
          .select({
            id: settlementsTable.id,
            periodStart: settlementsTable.periodStart,
            periodEnd: settlementsTable.periodEnd,
            policyCount: settlementsTable.policyCount,
            premiumTotal: settlementsTable.premiumTotal,
            commissionTotal: settlementsTable.commissionTotal,
            status: settlementsTable.status,
          })
          .from(settlementsTable)
          .where(eq(settlementsTable.storeId, storeId))
          .orderBy(desc(settlementsTable.periodStart))
          .limit(RECENT_LIMIT),

        // The event payload is left out: it can hold customer details.
        db
          .select({
            id: webhookEventsTable.id,
            eventId: webhookEventsTable.eventId,
            type: webhookEventsTable.type,
            status: webhookEventsTable.status,
            receivedAt: webhookEventsTable.receivedAt,
            processedAt: webhookEventsTable.processedAt,
          })
          .from(webhookEventsTable)
          .where(eq(webhookEventsTable.storeId, storeId))
          .orderBy(desc(webhookEventsTable.receivedAt), desc(webhookEventsTable.id))
          .limit(RECENT_LIMIT),
      ]);

      res.json({ sales, recentPolicies, settlements, webhookEvents });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
