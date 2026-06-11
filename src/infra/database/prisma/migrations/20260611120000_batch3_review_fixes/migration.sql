-- ════════════════════════════════════════════════════════════════════
-- Batch 3 review fixes
--  1) Supplier credit tracking columns (FIN-003: update supplier credit_used)
--  2) document_sequences: partial unique index so branchId IS NULL rows
--     cannot be duplicated by concurrent auto-creates (PG treats NULLs as
--     distinct in the composite unique index)
--  3) Row-Level Security, corrected and actually applied:
--     - previous manual_rls_policies.sql used snake_case `tenant_id`, but the
--       real columns are camelCase ("tenantId") — every CREATE POLICY failed
--     - policies now live in a real migration so `prisma migrate` applies them
--     - FORCE ROW LEVEL SECURITY so the table owner does not bypass RLS
--
-- RLS enforcement model: the app sets `app.current_tenant_id` with
-- `set_config(..., true)` (transaction-local) inside every $transaction
-- (see PrismaService). When the setting is absent (single queries outside a
-- transaction, migrations, seeds) the policies PASS and app-level
-- `where: { tenantId }` filters remain the primary guard. When the setting
-- is present, the database enforces tenant isolation as defense-in-depth
-- for all multi-step money/inventory flows.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) Supplier credit tracking ──────────────────────────────────────
ALTER TABLE "suppliers" ADD COLUMN "creditLimit" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "suppliers" ADD COLUMN "creditUsed"  DECIMAL(15,2) NOT NULL DEFAULT 0;

-- ── 2) Sequence uniqueness for NULL branch ───────────────────────────
CREATE UNIQUE INDEX "document_sequences_tenant_type_null_branch_key"
  ON "document_sequences" ("tenantId", "documentType")
  WHERE "branchId" IS NULL;

-- ── 3) Row-Level Security ────────────────────────────────────────────

-- Returns the tenant id bound to the current transaction, or NULL when no
-- context has been set (migrations, seeds, out-of-transaction queries).
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

-- ---- Tables with a direct "tenantId" column ----
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- Batch 1
    'users', 'branches', 'roles', 'audit_logs', 'document_sequences', 'subscriptions',
    -- Batch 2
    'item_categories', 'items', 'boms', 'warehouses',
    'inventory_balances', 'stock_movements', 'lots',
    -- Batch 3
    'suppliers', 'customers', 'purchase_orders', 'goods_receipts', 'sales_orders',
    'chart_of_accounts', 'fiscal_periods', 'journal_batches', 'invoices', 'payments'
  ]
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

-- ---- Child tables isolated via their parent's tenant ----

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_roles";
CREATE POLICY tenant_isolation ON "user_roles"
  USING (app_current_tenant_id() IS NULL OR "roleId" IN
    (SELECT id FROM roles WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "roleId" IN
    (SELECT id FROM roles WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "role_permissions";
CREATE POLICY tenant_isolation ON "role_permissions"
  USING (app_current_tenant_id() IS NULL OR "roleId" IN
    (SELECT id FROM roles WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "roleId" IN
    (SELECT id FROM roles WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "refresh_tokens";
CREATE POLICY tenant_isolation ON "refresh_tokens"
  USING (app_current_tenant_id() IS NULL OR "userId" IN
    (SELECT id FROM users WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "userId" IN
    (SELECT id FROM users WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "zones" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "zones";
CREATE POLICY tenant_isolation ON "zones"
  USING (app_current_tenant_id() IS NULL OR "warehouseId" IN
    (SELECT id FROM warehouses WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "warehouseId" IN
    (SELECT id FROM warehouses WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "bins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bins" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "bins";
CREATE POLICY tenant_isolation ON "bins"
  USING (app_current_tenant_id() IS NULL OR "zoneId" IN
    (SELECT z.id FROM zones z JOIN warehouses w ON w.id = z."warehouseId"
     WHERE w."tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "zoneId" IN
    (SELECT z.id FROM zones z JOIN warehouses w ON w.id = z."warehouseId"
     WHERE w."tenantId" = app_current_tenant_id()));

ALTER TABLE "bom_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bom_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "bom_lines";
CREATE POLICY tenant_isolation ON "bom_lines"
  USING (app_current_tenant_id() IS NULL OR "bomId" IN
    (SELECT id FROM boms WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "bomId" IN
    (SELECT id FROM boms WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "purchase_order_lines";
CREATE POLICY tenant_isolation ON "purchase_order_lines"
  USING (app_current_tenant_id() IS NULL OR "poId" IN
    (SELECT id FROM purchase_orders WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "poId" IN
    (SELECT id FROM purchase_orders WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "goods_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "goods_receipt_lines";
CREATE POLICY tenant_isolation ON "goods_receipt_lines"
  USING (app_current_tenant_id() IS NULL OR "grnId" IN
    (SELECT id FROM goods_receipts WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "grnId" IN
    (SELECT id FROM goods_receipts WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "sales_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_order_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "sales_order_lines";
CREATE POLICY tenant_isolation ON "sales_order_lines"
  USING (app_current_tenant_id() IS NULL OR "soId" IN
    (SELECT id FROM sales_orders WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "soId" IN
    (SELECT id FROM sales_orders WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "journal_entries";
CREATE POLICY tenant_isolation ON "journal_entries"
  USING (app_current_tenant_id() IS NULL OR "batchId" IN
    (SELECT id FROM journal_batches WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "batchId" IN
    (SELECT id FROM journal_batches WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payment_allocations";
CREATE POLICY tenant_isolation ON "payment_allocations"
  USING (app_current_tenant_id() IS NULL OR "paymentId" IN
    (SELECT id FROM payments WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "paymentId" IN
    (SELECT id FROM payments WHERE "tenantId" = app_current_tenant_id()));
