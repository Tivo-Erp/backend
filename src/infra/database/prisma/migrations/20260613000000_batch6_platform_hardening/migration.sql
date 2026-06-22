-- ============================================================
-- BATCH 6 — Platform Hardening & Cross-Cutting Infrastructure
--   SEC-001 (auth hardening), INF-002 (outbox), INF-004 (FTS)
-- ============================================================

-- ---- SEC-001: User email verification ----
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

-- ---- SEC-001: Refresh-token rotation family ----
ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "familyId" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "replacedById" UUID;
CREATE INDEX IF NOT EXISTS "refresh_tokens_familyId_idx" ON "refresh_tokens" ("familyId");

-- ---- SEC-001: Single-use hashed auth tokens ----
CREATE TABLE IF NOT EXISTS "auth_tokens" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "type"      VARCHAR(30) NOT NULL,
  "tokenHash" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_tokens_tokenHash_key" ON "auth_tokens" ("tokenHash");
CREATE INDEX IF NOT EXISTS "auth_tokens_userId_type_idx" ON "auth_tokens" ("userId", "type");

-- ---- INF-002: Transactional outbox ----
CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"      UUID NOT NULL,
  "aggregateType" VARCHAR(50) NOT NULL,
  "aggregateId"   VARCHAR(64) NOT NULL,
  "eventType"     VARCHAR(100) NOT NULL,
  "payload"       JSONB NOT NULL,
  "status"        VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt"   TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "outbox_events_status_createdAt_idx" ON "outbox_events" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "outbox_events_tenantId_idx" ON "outbox_events" ("tenantId");

-- RLS for the new tenant-scoped table (reuses app_current_tenant_id() from
-- migration 20260611120000). Passes when no tenant context is set, so the
-- system-wide outbox dispatcher can read across tenants.
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "outbox_events";
CREATE POLICY tenant_isolation ON "outbox_events"
  USING (app_current_tenant_id() IS NULL OR "tenantId" = app_current_tenant_id())
  WITH CHECK (app_current_tenant_id() IS NULL OR "tenantId" = app_current_tenant_id());

-- ---- INF-004: PostgreSQL full-text search ----
-- Generated tsvector columns + GIN indexes. The 'simple' config keeps it
-- language-agnostic (works for VN/EN product + party names).

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("name", '') || ' ' || coalesce("sku", '') || ' ' || coalesce("description", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "items_search_idx" ON "items" USING GIN ("search_vector");

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("name", '') || ' ' || coalesce("code", '') || ' '
      || coalesce("legalName", '') || ' ' || coalesce("contactName", '') || ' '
      || coalesce("email", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "customers_search_idx" ON "customers" USING GIN ("search_vector");

ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("name", '') || ' ' || coalesce("code", '') || ' '
      || coalesce("legalName", '') || ' ' || coalesce("contactName", '') || ' '
      || coalesce("email", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "suppliers_search_idx" ON "suppliers" USING GIN ("search_vector");

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("companyName", '') || ' ' || coalesce("contactName", '') || ' '
      || coalesce("email", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "leads_search_idx" ON "leads" USING GIN ("search_vector");

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce("name", '') || ' ' || coalesce("code", '') || ' ' || coalesce("description", ''))
  ) STORED;
CREATE INDEX IF NOT EXISTS "projects_search_idx" ON "projects" USING GIN ("search_vector");
