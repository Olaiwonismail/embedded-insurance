import express, { Express, Request, Response, NextFunction } from 'express';

import { Db } from './db';
import healthRoutes from './routes/health';
import usersRoutes from './routes/users';
import { createOnboardingRouter } from './routes/onboarding';
import { createAdminStoresRouter } from './routes/adminStores';
import { createMerchantRouter } from './routes/merchant';
import { createQuotesRouter } from './routes/quotes';
import { createWidgetAuth } from './middleware/widgetAuth';

import { createWebhooksRouter } from './routes/webhooks';

export function createApp(db: Db): Express {
  const app = express();

  // Behind a proxy (the web container's nginx), every request comes from the proxy,
  // so rate limits would be shared by everyone. TRUST_PROXY names which proxies to
  // believe, e.g. "uniquelocal" for Docker's private network. Unset: trust none.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY);
  }

  // Webhook signatures require exact raw bytes; mounted before express.json()
  app.use('/v1/webhooks', createWebhooksRouter(db));

  app.use(express.json());

  app.get('/', (_req: Request, res: Response) => {
    res.send('Hello, World!');
  });

  app.use('/health', healthRoutes);
  app.use('/users', usersRoutes);
  app.use('/v1/onboardStores', createOnboardingRouter(db));
  app.use('/v1/admin/stores', createAdminStoresRouter(db));
  app.use('/v1/merchant', createMerchantRouter(db));
  app.use('/v1/quotes', createWidgetAuth(db), createQuotesRouter(db));

  // Never log err.message or the request: driver errors embed query params,
  // and JSON parse errors embed part of the body.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
      return;
    }
    console.error('Unhandled error:', err?.name, err?.code ?? err?.cause?.code ?? '');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
