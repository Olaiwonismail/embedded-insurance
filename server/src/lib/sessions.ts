import { createHash, randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { and, eq, lt } from 'drizzle-orm';

import { Db } from '../db';
import { merchantSessionsTable } from '../db/schema';

export const SESSION_COOKIE = 'iog_session';
export const SESSION_HOURS = 8;
// The cookie is only sent to the dashboard API, not to every request.
const COOKIE_PATH = '/v1/merchant';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Starts a session for the store and sets the cookie on the response.
export async function startSession(db: Db, req: Request, res: Response, storeId: number) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);

  // Tidy up this store's expired sessions while we're here.
  await db
    .delete(merchantSessionsTable)
    .where(
      and(eq(merchantSessionsTable.storeId, storeId), lt(merchantSessionsTable.expiresAt, new Date())),
    );
  await db.insert(merchantSessionsTable).values({ storeId, tokenHash: hashToken(token), expiresAt });

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // page scripts cannot read it
    sameSite: 'strict', // not sent on requests started by other sites
    secure: req.secure, // https only when served over https
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
}

// Reads our cookie from the Cookie header (no cookie-parser dependency).
export function readSessionToken(req: Request): string | null {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      const value = rest.join('=');
      return value || null;
    }
  }
  return null;
}
