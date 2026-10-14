import { Router, Request, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

import { getDefaultCommissionRate } from '../config';
import { Db } from '../db';
import { storesTable } from '../db/schema';
import { hashPassword } from '../lib/passwords';
import { encryptSecret } from '../lib/secrets';
import { startSession } from '../lib/sessions';
import {
  generatePublicKey,
  generateSecretKey,
  generateWebhookSecret,
  hashSecretKey,
} from '../lib/keys';

export const PLATFORMS = ['shopify', 'woocommerce', 'custom'] as const;
// Standard categories. Merchants can also name their own products (see CUSTOM_CATEGORY);
// those are saved too but only get quotes once an insurance plan covers them.
export const CATEGORIES = ['phones', 'laptops', 'tablets'] as const;
export const MAX_CATEGORIES = 20;

// A merchant-named product type such as "smartwatches" or "game consoles".
const CUSTOM_CATEGORY = /^[a-z0-9][a-z0-9 &'-]{1,49}$/;

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
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .overwrite((name) => name.replace(/\s+/g, ' '))
        .regex(
          CUSTOM_CATEGORY,
          'must be 2 to 50 characters: letters, numbers, spaces, &, \' or -',
        ),
    )
    .min(1)
    .max(MAX_CATEGORIES)
    .transform((categories) => [...new Set(categories)]),
  // Also the dashboard sign-in email.
  billingEmail: z.email().max(255),
  // Length only, no character rules (NIST 800-63B). 200 caps hashing work.
  password: z.string().min(10, 'must be at least 10 characters').max(200),
  webhookSecret: z.string().min(1).optional(),
});

const UNIQUE_VIOLATION = '23505';

// Drizzle may wrap the driver error, so look at the cause too.
function isUniqueViolation(err: unknown, constraint: RegExp): boolean {
  for (let e: any = err; e; e = e.cause) {
    if (e.code === UNIQUE_VIOLATION && constraint.test(String(e.constraint ?? ''))) {
      return true;
    }
  }
  return false;
}

// Postgres names this one stores_publicKey_key.
const isPublicKeyCollision = (err: unknown) => isUniqueViolation(err, /public_?key/i);
// Named in schema.ts.
const isLoginEmailTaken = (err: unknown) => isUniqueViolation(err, /^stores_login_email_uq$/);

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
        passwordHash: await hashPassword(input.password),
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

      // Signed in straight away, so the merchant can go on to their dashboard.
      await startSession(db, req, res, store.id);

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
      if (isLoginEmailTaken(err)) {
        res.status(409).json({
          error: 'An account with this email already exists. Sign in instead.',
          details: [{ field: 'billingEmail', message: 'is already used by another account' }],
        });
        return;
      }
      next(err);
    }
  });

  return router;
}
