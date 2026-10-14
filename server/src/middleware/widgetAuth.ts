import { Request, RequestHandler } from 'express';
import { eq } from 'drizzle-orm';

import { Db } from '../db';
import { storesTable } from '../db/schema';
import { StoreWithoutSecrets, storeColumnsWithoutSecrets } from '../db/storeColumns';

// Checks widget calls coming from a shopper's browser.
// Origin can be faked by any script outside a browser, so this only stops other
// websites from using a copied public key. Use it for harmless actions only (quotes);
// anything that changes data needs a stronger check.

// The header name is not final; change it here only.
export const PUBLIC_KEY_HEADER = 'x-insureongo-public-key';

const MAX_PUBLIC_KEY_LENGTH = 255;

// The store without its secrets, so a route cannot send them back by mistake.
export type WidgetStore = StoreWithoutSecrets;

declare global {
  namespace Express {
    interface Request {
      // Set by createWidgetAuth once the call has passed the check.
      store?: WidgetStore;
    }
  }
}

// True when the Origin's hostname is a listed domain or a subdomain of one.
// Matches whole name parts only: 3chub.com allows www.3chub.com but not
// evil3chub.com or 3chub.com.evil.com.
export function isAllowedOrigin(origin: string | undefined, allowedDomains: string[]): boolean {
  if (!origin) return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the literal "null" origin
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  // URL already lowercases the hostname and drops the port.
  const host = url.hostname.replace(/\.$/, '');
  if (!host) return false;

  return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function createWidgetAuth(db: Db): RequestHandler {
  return async (req: Request, res, next) => {
    try {
      const publicKey = req.get(PUBLIC_KEY_HEADER);
      if (!publicKey || publicKey.length > MAX_PUBLIC_KEY_LENGTH) {
        res.status(401).json({ error: 'Invalid public key' });
        return;
      }

      const [store] = await db
        .select(storeColumnsWithoutSecrets)
        .from(storesTable)
        .where(eq(storesTable.publicKey, publicKey))
        .limit(1);
      if (!store) {
        res.status(401).json({ error: 'Invalid public key' });
        return;
      }

      if (store.status !== 'active') {
        res.status(403).json({ error: 'Store is not active' });
        return;
      }

      if (!isAllowedOrigin(req.get('origin'), store.allowedDomains)) {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
      }

      req.store = store;
      next();
    } catch (err) {
      next(err);
    }
  };
}
