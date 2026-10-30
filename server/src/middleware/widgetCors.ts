import { Request, RequestHandler, Response } from 'express';
import { and, arrayOverlaps, eq } from 'drizzle-orm';

import { Db } from '../db';
import { storesTable } from '../db/schema';
import { PUBLIC_KEY_HEADER, originHost } from './widgetAuth';

// The widget runs on the merchant's domain and sends a custom header, so the browser
// asks permission with an OPTIONS request first.

const MAX_AGE_SECONDS = 600;

// Every domain a store could have listed that would allow this host:
// www.shop.example.com -> www.shop.example.com, shop.example.com, example.com, com.
// Mirrors the suffix rule in isAllowedOrigin, so an exact array overlap is enough.
export function hostSuffixes(host: string): string[] {
  const parts = host.split('.');
  return parts.map((_part, index) => parts.slice(index).join('.'));
}

function allowOrigin(res: Response, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
}

// A preflight carries no custom headers, so there is no public key to find the store
// by. Any active store listing the origin is enough to answer it; the real POST is
// still checked against its own store by createWidgetAuth.
export function createWidgetPreflight(db: Db): RequestHandler {
  return async (req: Request, res, next) => {
    res.appendHeader('Vary', 'Origin');

    if (req.method !== 'OPTIONS') {
      next();
      return;
    }

    try {
      const host = originHost(req.get('origin'));
      if (host) {
        const [match] = await db
          .select({ id: storesTable.id })
          .from(storesTable)
          .where(
            and(
              eq(storesTable.status, 'active'),
              arrayOverlaps(storesTable.allowedDomains, hostSuffixes(host)),
            ),
          )
          .limit(1);

        if (match) {
          allowOrigin(res, req.get('origin')!);
          res.setHeader('Access-Control-Allow-Methods', 'POST');
          res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${PUBLIC_KEY_HEADER}`);
          res.setHeader('Access-Control-Max-Age', String(MAX_AGE_SECONDS));
        }
      }

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  };
}

// Mounted after createWidgetAuth, which has already matched this Origin against the
// store's own domains, so there is nothing left to check and no extra query to make.
export const allowWidgetOrigin: RequestHandler = (req: Request, res, next) => {
  const origin = req.get('origin');
  if (req.store && origin) allowOrigin(res, origin);
  next();
};
