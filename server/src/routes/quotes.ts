import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';

import { Db } from '../db';
import { quotesTable } from '../db/schema';
import {
  InsureongoClient,
  fakeInsureongoClient,
} from '../lib/insureongo';

export const ITEM_CATEGORIES = ['phones', 'laptops', 'tablets'] as const;
export const ITEM_CONDITIONS = ['new', 'used'] as const;

const quoteRequestSchema = z.strictObject({
  storeItemRef: z.string().max(255).optional(),
  itemName: z.string().min(1).max(255),
  itemCategory: z.enum(ITEM_CATEGORIES),
  itemPrice: z.number().positive().multipleOf(0.01),
  itemCondition: z.enum(ITEM_CONDITIONS),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function createQuotesRouter(
  db: Db,
  client: InsureongoClient = fakeInsureongoClient,
): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = quoteRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request',
          details: parsed.error.issues.map((issue) => ({
            field: issue.path.join('.') || null,
            message: issue.message,
          })),
        });
        return;
      }
      const input = parsed.data;
      const store = req.store!;

      // If the item's category is not enabled for this store, there's nothing to offer.
      if (!store.enabledCategories.includes(input.itemCategory)) {
        res.status(204).send();
        return;
      }

      const matches = await client.getQuotes({
        itemName: input.itemName,
        itemCategory: input.itemCategory,
        itemPrice: input.itemPrice,
        itemCondition: input.itemCondition,
      });

      // insureOnGo has no insurer for this item.
      if (matches.length === 0) {
        res.status(204).send();
        return;
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);

      const rows = matches.map((match) => ({
        storeId: store.id,
        storeItemRef: input.storeItemRef ?? null,
        itemName: input.itemName,
        itemCategory: input.itemCategory,
        itemPrice: String(input.itemPrice),
        itemCondition: input.itemCondition,
        insureongoQuoteId: match.quoteId,
        insurerName: match.insurerName,
        planName: match.planName,
        premium: match.premium,
        status: 'offered',
        expiresAt,
      }));

      const saved = await db
        .insert(quotesTable)
        .values(rows)
        .returning({
          id: quotesTable.id,
          insurerName: quotesTable.insurerName,
          planName: quotesTable.planName,
          premium: quotesTable.premium,
        });

      res.status(200).json(saved);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
