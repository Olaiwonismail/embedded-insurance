import express, { Router } from 'express';
import { eq } from 'drizzle-orm';

import { Db } from '../db';
import { storesTable, webhookEventsTable } from '../db/schema';
import { decryptSecret } from '../lib/secrets';
import { getPlatformVerifier, WebhookValidationError } from '../lib/webhooks';

export function createWebhooksRouter(db: Db): Router {
  const router = Router();

  // Raw body captured at route level before any JSON parser rewrites it
  router.use(express.raw({ type: '*/*', limit: '10mb' }));

  router.post('/:platform/:publicKey', async (req, res, next) => {
    try {
      const { platform, publicKey } = req.params;

      const verifier = getPlatformVerifier(platform);
      if (!verifier) {
        res.status(404).json({ error: 'Unknown platform' });
        return;
      }

      // 1. Find the store by publicKey from the URL. No match: respond 404.
      const [store] = await db
        .select({
          id: storesTable.id,
          status: storesTable.status,
          webhookSecret: storesTable.webhookSecret,
        })
        .from(storesTable)
        .where(eq(storesTable.publicKey, publicKey))
        .limit(1);

      if (!store) {
        res.status(404).json({ error: 'Store not found' });
        return;
      }

      // 2. If the store's status is not active: respond 403.
      if (store.status !== 'active') {
        res.status(403).json({ error: 'Store is not active' });
        return;
      }

      // 3. Decrypt the store's webhookSecret.
      const webhookSecret = decryptSecret(store.webhookSecret);

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === 'string'
          ? Buffer.from(req.body, 'utf8')
          : Buffer.alloc(0);

      // 4. Verify the signature with the right verifier for :platform. Fail: respond 401.
      const isValid = verifier.verifySignature(req, rawBody, webhookSecret);
      if (!isValid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      // 5. Parse the body as JSON. Read eventId and type using the platform's rules.
      let eventData;
      try {
        eventData = verifier.extractEvent(req, rawBody);
      } catch (err) {
        if (err instanceof WebhookValidationError || err instanceof SyntaxError) {
          res.status(400).json({ error: (err as Error).message });
          return;
        }
        throw err;
      }

      // 6. Insert into webhook_events with storeId, eventId, type, payload, and status: "received".
      // On a conflict with the unique index (storeId, eventId), do nothing. This makes repeats harmless.
      await db
        .insert(webhookEventsTable)
        .values({
          storeId: store.id,
          eventId: eventData.eventId,
          type: eventData.type,
          payload: eventData.payload,
          status: 'received',
        })
        .onConflictDoNothing();

      // 7. Respond 200 within a few hundred milliseconds. Do no more work on this request.
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
