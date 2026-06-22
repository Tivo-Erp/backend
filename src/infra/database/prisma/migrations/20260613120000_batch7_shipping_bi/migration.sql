-- ════════════════════════════════════════════════════════════════════
-- BATCH 7 — Shipping & Logistics (M-SHP)
--   SHP-001 Carrier, SHP-002 Shipment + TrackingEvent, SHP-003 DN→carrier FK
--   (BI/M-BI uses a separate DuckDB OLAP store — no OLTP tables here.)
--   app_current_tenant_id() already exists from migration 20260611120000.
-- ════════════════════════════════════════════════════════════════════

-- ---- 1) Carriers ----
CREATE TABLE IF NOT EXISTS "carriers" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"        UUID NOT NULL,
  "code"            VARCHAR(30) NOT NULL,
  "name"            VARCHAR(200) NOT NULL,
  "apiEndpoint"     TEXT,
  "apiKeyEncrypted" TEXT,
  "webhookSecret"   VARCHAR(255),
  "config"          JSONB,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "carriers_tenantId_code_key" ON "carriers" ("tenantId", "code");
CREATE INDEX IF NOT EXISTS "carriers_tenantId_isActive_idx" ON "carriers" ("tenantId", "isActive");

-- ---- 2) Shipments ----
CREATE TABLE IF NOT EXISTS "shipments" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"          UUID NOT NULL,
  "shipmentNumber"    VARCHAR(30) NOT NULL,
  "dnId"              UUID NOT NULL,
  "carrierId"         UUID NOT NULL,
  "trackingNumber"    VARCHAR(100),
  "shippingLabelKey"  TEXT,
  "status"            VARCHAR(30) NOT NULL DEFAULT 'created',
  "serviceType"       VARCHAR(50),
  "weightKg"          DECIMAL(10,3),
  "lengthCm"          DECIMAL(10,2),
  "widthCm"           DECIMAL(10,2),
  "heightCm"          DECIMAL(10,2),
  "isCod"             BOOLEAN NOT NULL DEFAULT false,
  "codAmount"         DECIMAL(19,4),
  "shippingCost"      DECIMAL(19,4),
  "trackingToken"     VARCHAR(64),
  "estimatedDelivery" TIMESTAMP(3),
  "actualDelivery"    TIMESTAMP(3),
  "failureReason"     VARCHAR(255),
  "createdBy"         UUID NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_dnId_key" ON "shipments" ("dnId");
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_trackingToken_key" ON "shipments" ("trackingToken");
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_tenantId_shipmentNumber_key" ON "shipments" ("tenantId", "shipmentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "shipments_tenantId_trackingNumber_key" ON "shipments" ("tenantId", "trackingNumber");
CREATE INDEX IF NOT EXISTS "shipments_tenantId_status_idx" ON "shipments" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "shipments_carrierId_idx" ON "shipments" ("carrierId");

-- ---- 3) Tracking events ----
CREATE TABLE IF NOT EXISTS "tracking_events" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shipmentId"  UUID NOT NULL,
  "status"      VARCHAR(30) NOT NULL,
  "description" TEXT,
  "location"    VARCHAR(255),
  "eventTime"   TIMESTAMP(3) NOT NULL,
  "rawData"     JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "tracking_events_shipmentId_eventTime_idx" ON "tracking_events" ("shipmentId", "eventTime");

-- ---- 4) Foreign keys ----
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_dnId_fkey"
  FOREIGN KEY ("dnId") REFERENCES "delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipmentId_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SHP-003: the previously-dangling DeliveryNote.carrierId becomes a real FK.
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_carrierId_fkey"
  FOREIGN KEY ("carrierId") REFERENCES "carriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 5) Row-Level Security (parity with batch 3/4/5)
-- ════════════════════════════════════════════════════════════════════

-- ---- Tables with a direct "tenantId" column ----
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['carriers', 'shipments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (app_current_tenant_id() IS NULL OR "tenantId" = app_current_tenant_id()) '
      || 'WITH CHECK (app_current_tenant_id() IS NULL OR "tenantId" = app_current_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- ---- Child table isolated via its parent's tenant ----
ALTER TABLE "tracking_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracking_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tracking_events";
CREATE POLICY tenant_isolation ON "tracking_events"
  USING (app_current_tenant_id() IS NULL OR "shipmentId" IN
    (SELECT id FROM shipments WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "shipmentId" IN
    (SELECT id FROM shipments WHERE "tenantId" = app_current_tenant_id()));
