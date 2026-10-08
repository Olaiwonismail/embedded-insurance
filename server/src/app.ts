import express, { Express, Request, Response, NextFunction } from 'express';

import { Db } from './db';
import healthRoutes from './routes/health';
import usersRoutes from './routes/users';
import { createOnboardingRouter } from './routes/onboarding';

export function createApp(db: Db): Express {
  const app = express();

  app.use(express.json());

  app.get('/', (_req: Request, res: Response) => {
    res.send('Hello, World!');
  });

  app.use('/health', healthRoutes);
  app.use('/users', usersRoutes);
  app.use('/v1/onboardStores', createOnboardingRouter(db));

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
