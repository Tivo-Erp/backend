import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * INF-006 — initialise Sentry error tracking when `SENTRY_DSN` is set. Called
 * once from `main.ts` before the app starts. No DSN → tracking is a no-op.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
  enabled = true;
  new Logger('Sentry').log('Sentry error tracking initialised.');
}

/** Report an exception with correlation context. Safe to call when disabled. */
export function captureException(
  error: unknown,
  context?: { correlationId?: string; path?: string; tenantId?: string },
): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context?.correlationId)
      scope.setTag('correlationId', context.correlationId);
    if (context?.tenantId) scope.setTag('tenantId', context.tenantId);
    if (context?.path) scope.setExtra('path', context.path);
    Sentry.captureException(error);
  });
}
