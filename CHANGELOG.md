# Changelog

All notable changes to the ERP Backend are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- All service ports in `docker-compose.prod.yml` are now declarable in `.env.prod`:
  `APP_BIND_HOST`, `PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `RABBITMQ_PORT`. Each is
  wired consistently into the server config, the connection URL, and the
  healthcheck, so one variable change is sufficient.
- README: "Network Topology & Port Exposure" section documenting which ports are
  published vs internal-only, with a topology diagram.

### Changed

- Backing stores (postgres / redis / rabbitmq) remain internal-only on
  `erp-network`; only the API is published, on `${APP_BIND_HOST:-127.0.0.1}`
  (loopback) by default so a reverse proxy fronts it.
- Docker runtime image switched from `node:22-alpine` to `node:22-slim`
  (Debian/glibc) so the `duckdb` native package installs its prebuilt glibc
  binary — BI/OLAP now works in the container with no build toolchain. Added
  `wget` + `ca-certificates` to the image (not bundled in slim) for the
  healthcheck and the prebuilt fetch.

### Fixed

- Worker boot crash — `Nest can't resolve dependencies of ChartOfAccountService
  (..., CacheService)`. The worker process bootstraps `WorkerModule`, which never
  imported the `@Global` `CacheModule` (a global module must still be imported
  once in the bootstrapped tree). Added `CacheModule` to `WorkerModule`.
- Boot crash `Error: Queue name cannot contain :` — BullMQ v5 forbids `:` in
  queue names. Renamed the queues `erp:cron` / `erp:email` / `erp:outbox` to use
  `-` (`erp-cron` / `erp-email` / `erp-outbox`).
- `npm ci` failed in the Docker build (`EUSAGE: ... Missing: duckdb from lock
  file`) because `package-lock.json` was out of sync with the optional `duckdb`
  dependency. Regenerated the lock so `npm ci` is consistent (`duckdb` stays an
  optional dependency and is loaded via a runtime dynamic import).

## [0.1.0] - 2026-06-22

First consolidated, production-hardened release. Adds the platform infrastructure
(Batch 6) and the shipping + BI modules (Batch 7) on top of the core business
modules, hardens authentication, and brings the codebase to full type-safety
(0 ESLint errors, clean `tsc`, 354 passing unit tests).

### Added

- **Background worker** (`worker.ts`, `npm run start:worker`) — BullMQ job
  processors (email, cron), scheduled jobs, and domain-event consumers running
  as a separate process.
- **Transactional outbox + event bus** — outbox dispatcher with SLA handling and
  a RabbitMQ publisher/consumer for domain events (`erp.events` exchange).
- **Observability** — Prometheus metrics endpoint (`GET /metrics`, token-protected),
  Sentry error tracking, and structured JSON logging via pino with correlation IDs.
- **Caching & rate limiting** — Redis-backed cache service and Redis-backed
  throttler storage.
- **Object storage** — S3 / MinIO presigned upload endpoints.
- **Transactional email** — Resend integration with HTML templates (falls back to
  logging when no API key is set).
- **Health checks** — `GET /health` and readiness probe (Terminus) wired into the
  Docker `HEALTHCHECK`.
- **M-SHP Shipping** — carriers, shipments, tracking, carrier adapter abstraction
  (mock adapter included), HMAC-verified public tracking webhook.
- **M-BI / OLAP** — DuckDB analytics store, cube registry, dashboards, and ETL
  service (`/bi` endpoints return 503 until `DUCKDB_PATH` is configured).
- **M-DEL Delivery Notes**, **M-CRM** (leads / opportunities / tickets),
  **M-PMO** (projects / tasks / timesheets), and **Fixed Assets** + **Financial
  Reports** under M-FIN.
- **Production deployment assets** — `docker-compose.prod.yml`, `.env.prod.example`,
  multi-stage `Dockerfile` (non-root user, `dumb-init`, idempotent
  `prisma migrate deploy` on startup), and a GitHub Actions CI pipeline.

### Changed

- **Full type-safety pass** — replaced loosely-typed Prisma access across 55
  source files with generated types (`Prisma.<Model>WhereInput`, `GetPayload`,
  `TransactionClient`, `Select` / `OrderBy`), eliminating all 1008 ESLint
  `no-unsafe-*` errors without `eslint-disable`, `as any`, or `@ts-ignore`.
- ESLint config now relaxes the type-checked `no-unsafe-*` family for `*.spec.ts`
  test files only; production code under `src/` stays fully type-safe.
- `bootstrap()` in `main.ts` now catches fatal startup errors and exits non-zero.

### Security

- **Authentication hardening** — MFA via TOTP, account lockout after configurable
  failed attempts, password-reset / email-verification token flows.
- **PII & MFA-secret encryption at rest** — AES-256-GCM (`PII_ENCRYPTION_KEY`).
- Swagger UI disabled in production unless explicitly enabled; CORS origins must
  be listed explicitly in production; Helmet security headers enabled.

### Fixed

- Worker Redis connection now honours `REDIS_URL` instead of silently falling
  back to `localhost:6379` (latent BullMQ configuration bug).

## [0.0.x] - prior batches

Earlier iterations established the foundation (not individually tagged):

- **Batch 4–5** — M-HRM, M-MFG, M-QC, M-WFL, M-NTF modules.
- **Batch 3** — M-PUR (procurement), M-SAL (sales), M-FIN (finance) + security
  review fixes.
- **Batch 2** — M-MAT (master data), M-WMS (warehouse), M-INV (inventory).
- **Batch 1** — core platform: multi-tenant auth (JWT RS256), M-ORG (tenant +
  branch), M-UAM (users / roles / permissions / audit log), RBAC + tenant guards,
  sparse fieldsets, pagination, Docker configuration, and unit tests.

[Unreleased]: https://github.com/Tivo-Erp/backend/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Tivo-Erp/backend/releases/tag/v0.1.0
