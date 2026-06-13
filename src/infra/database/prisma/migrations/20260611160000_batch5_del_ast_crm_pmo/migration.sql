-- Batch 5 — Delivery (M-DEL), Fixed Assets (M-AST), CRM (M-CRM), PMO (M-PMO)
-- DeliveryNote(+Line), FixedAsset(+DepreciationEntry), PipelineStage/Lead/Opportunity/
-- Activity/SupportTicket(+Comment), Project/ProjectMember/ProjectTask/Milestone/Timesheet.
-- Financial Reports (FINR) are read-only over existing tables — no new tables.
-- Includes Row-Level Security parity with batch 1–4.

-- ════════════════════════════════════════════════════════════════════
-- 1) Tables
-- ════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "dnNumber" VARCHAR(30) NOT NULL,
    "soId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "shipDate" TIMESTAMP(3),
    "shippingAddress" TEXT,
    "contactPerson" VARCHAR(200),
    "contactPhone" VARCHAR(20),
    "deliveryInstructions" TEXT,
    "deliveryMethod" VARCHAR(20),
    "driverName" VARCHAR(200),
    "driverPhone" VARCHAR(20),
    "vehiclePlate" VARCHAR(20),
    "carrierId" UUID,
    "serviceType" VARCHAR(50),
    "packedWeightKg" DECIMAL(10,3),
    "totalPackages" INTEGER NOT NULL DEFAULT 1,
    "packingNotes" TEXT,
    "failureReason" VARCHAR(50),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "returnReason" VARCHAR(50),
    "returnWarehouseId" UUID,
    "podType" VARCHAR(20),
    "receiverName" VARCHAR(200),
    "podSignature" TEXT,
    "podPhotoUrls" JSONB,
    "podNotes" TEXT,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_note_lines" (
    "id" UUID NOT NULL,
    "dnId" UUID NOT NULL,
    "soLineId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "pickedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "binId" UUID,
    "lotId" UUID,
    "serialId" UUID,
    "actualBinId" UUID,
    "actualLotId" UUID,
    "actualSerialId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "delivery_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "assetCode" VARCHAR(100) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "accountCode" VARCHAR(20) NOT NULL,
    "acquisitionCost" DECIMAL(19,4) NOT NULL,
    "residualValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "inServiceDate" TIMESTAMP(3),
    "depreciationMethod" VARCHAR(20) NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "accumulatedDepreciation" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "expenseAccountCode" VARCHAR(20) NOT NULL DEFAULT '642',
    "departmentId" UUID,
    "branchId" UUID,
    "disposalDate" TIMESTAMP(3),
    "disposalProceeds" DECIMAL(19,4),
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciation_entries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "depreciationAmount" DECIMAL(19,4) NOT NULL,
    "accumulatedTotal" DECIMAL(19,4) NOT NULL,
    "journalBatchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "probabilityPct" INTEGER NOT NULL DEFAULT 0,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyName" VARCHAR(255) NOT NULL,
    "contactName" VARCHAR(200),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "source" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "score" INTEGER NOT NULL DEFAULT 0,
    "estimatedValue" DECIMAL(19,4),
    "assignedTo" UUID,
    "customerId" UUID,
    "convertedAt" TIMESTAMP(3),
    "lostReason" VARCHAR(255),
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "customerId" UUID,
    "leadId" UUID,
    "stageId" UUID NOT NULL,
    "expectedRevenue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "expectedCloseDate" TIMESTAMP(3),
    "assignedTo" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "wonAt" TIMESTAMP(3),
    "lostReason" VARCHAR(255),
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ticketNumber" VARCHAR(30) NOT NULL,
    "customerId" UUID NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "category" VARCHAR(50),
    "assignedTo" UUID,
    "slaDueAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "satisfactionScore" INTEGER,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "customerId" UUID,
    "managerId" UUID,
    "branchId" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'planning',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "startDate" TIMESTAMP(3) NOT NULL,
    "targetEndDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "budget" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'member',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "parentId" UUID,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "assignedTo" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'backlog',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "estimatedHours" DECIMAL(8,2),
    "actualHours" DECIMAL(8,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheets" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "taskId" UUID,
    "logDate" DATE NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "description" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);

-- ════════════════════════════════════════════════════════════════════
-- 2) Indexes & unique constraints
-- ════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX "delivery_notes_tenantId_dnNumber_key" ON "delivery_notes"("tenantId", "dnNumber");
CREATE INDEX "delivery_notes_tenantId_status_idx" ON "delivery_notes"("tenantId", "status");
CREATE INDEX "delivery_notes_tenantId_soId_idx" ON "delivery_notes"("tenantId", "soId");

CREATE INDEX "delivery_note_lines_dnId_idx" ON "delivery_note_lines"("dnId");

CREATE UNIQUE INDEX "fixed_assets_tenantId_assetCode_key" ON "fixed_assets"("tenantId", "assetCode");
CREATE INDEX "fixed_assets_tenantId_status_idx" ON "fixed_assets"("tenantId", "status");

CREATE UNIQUE INDEX "asset_depreciation_entries_assetId_year_month_key" ON "asset_depreciation_entries"("assetId", "year", "month");
CREATE INDEX "asset_depreciation_entries_tenantId_year_month_idx" ON "asset_depreciation_entries"("tenantId", "year", "month");

CREATE UNIQUE INDEX "pipeline_stages_tenantId_name_key" ON "pipeline_stages"("tenantId", "name");

CREATE INDEX "leads_tenantId_status_idx" ON "leads"("tenantId", "status");
CREATE INDEX "leads_tenantId_assignedTo_idx" ON "leads"("tenantId", "assignedTo");

CREATE INDEX "opportunities_tenantId_status_idx" ON "opportunities"("tenantId", "status");
CREATE INDEX "opportunities_tenantId_stageId_idx" ON "opportunities"("tenantId", "stageId");

CREATE UNIQUE INDEX "support_tickets_tenantId_ticketNumber_key" ON "support_tickets"("tenantId", "ticketNumber");
CREATE INDEX "support_tickets_tenantId_status_idx" ON "support_tickets"("tenantId", "status");
CREATE INDEX "support_tickets_tenantId_customerId_idx" ON "support_tickets"("tenantId", "customerId");

CREATE INDEX "ticket_comments_ticketId_idx" ON "ticket_comments"("ticketId");

CREATE UNIQUE INDEX "projects_tenantId_code_key" ON "projects"("tenantId", "code");
CREATE INDEX "projects_tenantId_status_idx" ON "projects"("tenantId", "status");

CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

CREATE INDEX "project_tasks_tenantId_projectId_status_idx" ON "project_tasks"("tenantId", "projectId", "status");

CREATE INDEX "milestones_tenantId_projectId_idx" ON "milestones"("tenantId", "projectId");

CREATE INDEX "timesheets_tenantId_employeeId_logDate_idx" ON "timesheets"("tenantId", "employeeId", "logDate");
CREATE INDEX "timesheets_tenantId_projectId_idx" ON "timesheets"("tenantId", "projectId");

-- ════════════════════════════════════════════════════════════════════
-- 3) Foreign keys (child tables)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "delivery_note_lines" ADD CONSTRAINT "delivery_note_lines_dnId_fkey"
    FOREIGN KEY ("dnId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_depreciation_entries" ADD CONSTRAINT "asset_depreciation_entries_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_stageId_fkey"
    FOREIGN KEY ("stageId") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 4) Row-Level Security (parity with batch 3/4)
--    app_current_tenant_id() already exists from migration 20260611120000.
-- ════════════════════════════════════════════════════════════════════

-- ---- Tables with a direct "tenantId" column ----
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'delivery_notes', 'fixed_assets', 'asset_depreciation_entries',
    'pipeline_stages', 'leads', 'opportunities',
    'support_tickets', 'projects', 'project_tasks', 'milestones', 'timesheets'
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

ALTER TABLE "delivery_note_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "delivery_note_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "delivery_note_lines";
CREATE POLICY tenant_isolation ON "delivery_note_lines"
  USING (app_current_tenant_id() IS NULL OR "dnId" IN
    (SELECT id FROM delivery_notes WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "dnId" IN
    (SELECT id FROM delivery_notes WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "ticket_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_comments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ticket_comments";
CREATE POLICY tenant_isolation ON "ticket_comments"
  USING (app_current_tenant_id() IS NULL OR "ticketId" IN
    (SELECT id FROM support_tickets WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "ticketId" IN
    (SELECT id FROM support_tickets WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "project_members";
CREATE POLICY tenant_isolation ON "project_members"
  USING (app_current_tenant_id() IS NULL OR "projectId" IN
    (SELECT id FROM projects WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "projectId" IN
    (SELECT id FROM projects WHERE "tenantId" = app_current_tenant_id()));
