import express, { Express, Request, Response, NextFunction } from 'express';

import { Db } from './db';
import { createHealthRouter } from './routes/health';
import usersRoutes from './routes/users';
import { createOnboardingRouter } from './routes/onboarding';
import { createAdminStoresRouter } from './routes/adminStores';
import { createMerchantRouter } from './routes/merchant';
import { createQuotesRouter } from './routes/quotes';
import widgetRoutes from './routes/widget';
import { createWidgetAuth } from './middleware/widgetAuth';
import { createWidgetPreflight, allowWidgetOrigin } from './middleware/widgetCors';

import { createWebhooksRouter } from './routes/webhooks';
import { reportError } from './lib/errors';
import { EmailSender, logOnlyEmailSender } from './lib/email';

// onEventSaved is handed each newly saved webhook_events row id. index.ts uses it to add
// an issuance job; tests leave it out. sender is only used by the admin bill-run route.
export function createApp(
  db: Db,
  onEventSaved: (eventId: number) => void = () => {},
  sender: EmailSender = logOnlyEmailSender,
): Express {
  const app = express();

  // Behind a proxy (the web container's nginx), every request comes from the proxy,
  // so rate limits would be shared by everyone. TRUST_PROXY names which proxies to
  // believe, e.g. "uniquelocal" for Docker's private network. Unset: trust none.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY);
  }

  // Webhook signatures require exact raw bytes; mounted before express.json()
  // Each newly saved event is queued for policy issuance.
  app.use('/v1/webhooks', createWebhooksRouter(db, onEventSaved));

  app.use(express.json());

  app.get('/', (_req: Request, res: Response) => {
    res.send('Hello, World!');
  });

  app.use('/health', createHealthRouter(db));
  app.use('/users', usersRoutes);
  app.use('/v1/onboardStores', createOnboardingRouter(db));
  app.use('/v1/admin/stores', createAdminStoresRouter(db, sender));
  app.use('/v1/merchant', createMerchantRouter(db));
  app.use('/widget', widgetRoutes);

  // The preflight runs before the auth check on purpose: a browser sends no custom
  // headers on an OPTIONS request, so there is no public key for the check to read.
  app.use(
    '/v1/quotes',
    createWidgetPreflight(db),
    createWidgetAuth(db),
    allowWidgetOrigin,
    createQuotesRouter(db),
  );

  // Never log err.message or the request: driver errors embed query params,
  // and JSON parse errors embed part of the body.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    console.error('Unhandled error:', err?.name, err?.code ?? err?.cause?.code ?? '');
    reportError(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
