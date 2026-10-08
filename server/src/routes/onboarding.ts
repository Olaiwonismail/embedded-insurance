import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { getDefaultCommissionRate } from '../config';
import { Db } from '../db';
import { storesTable } from '../db/schema';
import { encryptSecret } from '../lib/secrets';
import {
  generatePublicKey,
  generateSecretKey,
  generateWebhookSecret,
  hashSecretKey,
} from '../lib/keys';

export const PLATFORMS = ['shopify', 'woocommerce', 'custom'] as const;
export const CATEGORIES = ['phones', 'laptops', 'tablets'] as const;

// Bare lowercase hostname: no scheme, port or path, at least one dot.
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const signupSchema = z.strictObject({
  name: z.string().trim().min(1).max(255),
  platform: z.enum(PLATFORMS),
  allowedDomains: z
    .array(z.string().regex(HOSTNAME, 'must be a bare lowercase hostname such as example.com'))
    .min(1)
    .transform((domains) => [...new Set(domains)]),
  enabledCategories: z
    .array(z.enum(CATEGORIES))
    .min(1)
    .transform((categories) => [...new Set(categories)]),
  billingEmail: z.email().max(255),
  webhookSecret: z.string().min(1).optional(),
});

const UNIQUE_VIOLATION = '23505';

// Drizzle may wrap the driver error, so look at the cause too.
// The constraint is named stores_publicKey_key by Postgres.
function isPublicKeyCollision(err: unknown): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e.code === UNIQUE_VIOLATION && /public_?key/i.test(String(e.constraint ?? ''))) {
      return true;
    }
  }
  return false;
}

export function createOnboardingRouter(db: Db): Router {
  const router = Router();

  const signupLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many signup attempts, try again in a minute' },
  });

  router.post('/', signupLimiter, async (req: Request, res: Response, next: NextFunction) => {
    const parsed = signupSchema.safeParse(req.body);
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

    try {
      const secretKey = generateSecretKey();
      const generatedWebhookSecret = input.webhookSecret ? undefined : generateWebhookSecret();
      const webhookSecret = input.webhookSecret ?? generatedWebhookSecret!;

      const values = {
        name: input.name,
        platform: input.platform,
        allowedDomains: input.allowedDomains,
        enabledCategories: input.enabledCategories,
        billingEmail: input.billingEmail,
        secretKeyHash: hashSecretKey(secretKey),
        webhookSecret: encryptSecret(webhookSecret),
        status: 'pending',
        commissionRate: getDefaultCommissionRate(),
        settlementFrequency: 'daily',
      };

      const insertStore = () =>
        db
          .insert(storesTable)
          .values({ ...values, publicKey: generatePublicKey() })
          .returning({ id: storesTable.id, publicKey: storesTable.publicKey });

      let store;
      try {
        [store] = await insertStore();
      } catch (err) {
        if (!isPublicKeyCollision(err)) throw err;
        [store] = await insertStore();
      }

      res.status(201).json({
        id: store.id,
        name: values.name,
        status: values.status,
        publicKey: store.publicKey,
        secretKey,
        ...(generatedWebhookSecret && { webhookSecret: generatedWebhookSecret }),
        allowedDomains: values.allowedDomains,
        enabledCategories: values.enabledCategories,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
