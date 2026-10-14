import { createHash, timingSafeEqual } from 'crypto';
import { RequestHandler } from 'express';

import { getAdminApiKey } from '../config';

// The admin UI sends ADMIN_API_KEY in this header.
export const ADMIN_KEY_HEADER = 'x-admin-key';

// Hash both sides first so the comparison takes the same time whatever the length.
function keyMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function requireAdmin(): RequestHandler {
  return (req, res, next) => {
    const given = req.get(ADMIN_KEY_HEADER);
    if (!given || !keyMatches(given, getAdminApiKey())) {
      res.status(401).json({ error: 'Invalid admin key' });
      return;
    }
    next();
  };
}
