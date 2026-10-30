// Error reporting. Does nothing until SENTRY_DSN is set, so development and tests are
// unaffected and no DSN has to exist for the app to run.

import * as Sentry from '@sentry/node';

let enabled = false;

export function startErrorReporting(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Errors only. Tracing would sample request bodies, which carry customer details.
    tracesSampleRate: 0,
  });

  enabled = true;
  return true;
}

export function reportError(err: unknown, context?: Record<string, string | number>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
