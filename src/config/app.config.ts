import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  jwtPrivateKeyPath: process.env.JWT_PRIVATE_KEY_PATH || './keys/private.pem',
  jwtPublicKeyPath: process.env.JWT_PUBLIC_KEY_PATH || './keys/public.pem',
  jwtAccessTtl: parseInt(process.env.JWT_ACCESS_TTL || '3600', 10),
  jwtRefreshTtl: parseInt(process.env.JWT_REFRESH_TTL || '604800', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  authMaxFailedAttempts: parseInt(
    process.env.AUTH_MAX_FAILED_ATTEMPTS || '5',
    10,
  ),
  authLockDurationSec: parseInt(
    process.env.AUTH_LOCK_DURATION_SEC || '1800',
    10,
  ), // 30 min

  // ── Batch 6: cross-cutting infrastructure (all OPTIONAL — features
  //    self-disable / fall back to no-op when their env var is absent) ──
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  // Queue / cache (BullMQ + cache share REDIS_URL above). Cron toggles let a
  // single instance own the schedulers when scaled horizontally.
  cronEnabled: (process.env.CRON_ENABLED ?? 'true') === 'true',
  cacheEnabled: (process.env.CACHE_ENABLED ?? 'true') === 'true',
  cacheTtlSec: parseInt(process.env.CACHE_TTL_SEC || '60', 10),
  // RabbitMQ + transactional outbox
  rabbitmqUrl: process.env.RABBITMQ_URL || '',
  rabbitmqExchange: process.env.RABBITMQ_EXCHANGE || 'erp.events',
  // MinIO / S3 object storage
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Port: parseInt(process.env.S3_PORT || '443', 10),
  s3UseSsl: (process.env.S3_USE_SSL ?? 'true') === 'true',
  s3AccessKey: process.env.S3_ACCESS_KEY || '',
  s3SecretKey: process.env.S3_SECRET_KEY || '',
  s3Bucket: process.env.S3_BUCKET || 'erp-files',
  s3PresignTtlSec: parseInt(process.env.S3_PRESIGN_TTL_SEC || '300', 10),
  // Transactional email (Resend)
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'ERP <no-reply@example.com>',
  // Observability
  sentryDsn: process.env.SENTRY_DSN || '',
  metricsToken: process.env.METRICS_TOKEN || '',
  logLevel: process.env.LOG_LEVEL || 'info',
  // Auth hardening (SEC-001)
  mfaIssuer: process.env.MFA_ISSUER || 'ERP',
  passwordResetTtlSec: parseInt(
    process.env.PASSWORD_RESET_TTL_SEC || '1800',
    10,
  ),
  emailVerifyTtlSec: parseInt(process.env.EMAIL_VERIFY_TTL_SEC || '86400', 10),
  mfaChallengeTtlSec: parseInt(process.env.MFA_CHALLENGE_TTL_SEC || '300', 10),

  // ── Batch 7: BI / OLAP (ADR-011) ──
  // DuckDB column store. Unset ⇒ BI endpoints return 503 BI_OLAP_UNAVAILABLE
  // (optional-safe). ':memory:' is handy for dev/tests; a file path persists.
  duckdbPath: process.env.DUCKDB_PATH || '',
}));
