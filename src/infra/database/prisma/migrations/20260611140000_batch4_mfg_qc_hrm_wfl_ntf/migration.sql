-- Batch 4 — Manufacturing + QC + HRM + Workflow + Notifications
-- WorkOrder, QCInspection(+Result), NCRReport, Employee, LeaveType/Balance/Request,
-- PayrollRun(+Line), Workflow Definition/Step/Instance/Action, Notification(+Preference)
-- Includes Row-Level Security parity with batch 1–3 (see 20260611120000_batch3_review_fixes).

-- ════════════════════════════════════════════════════════════════════
-- 1) Tables
-- ════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "woNumber" VARCHAR(30) NOT NULL,
    "itemId" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "plannedQty" DECIMAL(15,4) NOT NULL,
    "producedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "plannedStartDate" TIMESTAMP(3) NOT NULL,
    "plannedEndDate" TIMESTAMP(3) NOT NULL,
    "actualStartDate" TIMESTAMP(3),
    "actualEndDate" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 5,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspections" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "inspectionNumber" VARCHAR(30) NOT NULL,
    "sourceType" VARCHAR(20) NOT NULL,
    "sourceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "totalQty" DECIMAL(15,4) NOT NULL,
    "acceptedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "rejectedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "inspectorId" UUID,
    "inspectorNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspection_results" (
    "id" UUID NOT NULL,
    "inspectionId" UUID NOT NULL,
    "criterionName" VARCHAR(200) NOT NULL,
    "measuredValue" DECIMAL(10,4),
    "passed" BOOLEAN NOT NULL,
    "notes" VARCHAR(500),

    CONSTRAINT "qc_inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncr_reports" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ncrNumber" VARCHAR(30) NOT NULL,
    "inspectionId" UUID,
    "description" TEXT NOT NULL,
    "disposition" VARCHAR(30) NOT NULL,
    "assignedTo" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ncr_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "employeeCode" VARCHAR(20) NOT NULL,
    "departmentId" UUID,
    "branchId" UUID,
    "position" VARCHAR(200),
    "joinDate" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'probation',
    "basicSalary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "fullNameEncrypted" TEXT NOT NULL,
    "dateOfBirthEncrypted" TEXT,
    "idNumberEncrypted" TEXT,
    "taxCodeEncrypted" TEXT,
    "socialInsNumEncrypted" TEXT,
    "bankAccNumEncrypted" TEXT,
    "bankName" VARCHAR(200),
    "numberOfDependents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "defaultDays" INTEGER NOT NULL DEFAULT 12,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "requiresDoc" BOOLEAN NOT NULL DEFAULT false,
    "maxCarryOver" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entitlement" DECIMAL(5,1) NOT NULL,
    "used" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "carryOver" DECIMAL(5,1) NOT NULL DEFAULT 0,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "leaveTypeId" UUID NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "totalDays" DECIMAL(5,1) NOT NULL,
    "halfDay" VARCHAR(20),
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "totalGross" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalNet" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalInsEmp" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalInsEmpl" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalPIT" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "journalBatchId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" UUID NOT NULL,
    "payrollRunId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "basicSalary" DECIMAL(15,2) NOT NULL,
    "allowances" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overtime" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bonuses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grossSalary" DECIMAL(15,2) NOT NULL,
    "empBHXH" DECIMAL(15,2) NOT NULL,
    "empBHYT" DECIMAL(15,2) NOT NULL,
    "empBHTN" DECIMAL(15,2) NOT NULL,
    "personalDeduction" DECIMAL(15,2) NOT NULL,
    "dependentDeduction" DECIMAL(15,2) NOT NULL,
    "taxableIncome" DECIMAL(15,2) NOT NULL,
    "pitAmount" DECIMAL(15,2) NOT NULL,
    "netSalary" DECIMAL(15,2) NOT NULL,
    "emplrBHXH" DECIMAL(15,2) NOT NULL,
    "emplrBHYT" DECIMAL(15,2) NOT NULL,
    "emplrBHTN" DECIMAL(15,2) NOT NULL,
    "totalCostToCompany" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_definitions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "triggerEntity" VARCHAR(50) NOT NULL,
    "triggerEvent" VARCHAR(50) NOT NULL,
    "triggerCondition" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "stepType" VARCHAR(20) NOT NULL,
    "approverType" VARCHAR(30),
    "approverId" UUID,
    "timeoutHours" INTEGER,
    "escalationTo" UUID,
    "config" JSONB,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" UUID NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "requestedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_actions" (
    "id" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "actorId" UUID NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "body" TEXT,
    "category" VARCHAR(20) NOT NULL,
    "entityType" VARCHAR(50),
    "entityId" UUID,
    "actionUrl" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- ════════════════════════════════════════════════════════════════════
-- 2) Indexes & unique constraints
-- ════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX "work_orders_tenantId_woNumber_key" ON "work_orders"("tenantId", "woNumber");
CREATE INDEX "work_orders_tenantId_status_idx" ON "work_orders"("tenantId", "status");

CREATE UNIQUE INDEX "qc_inspections_tenantId_inspectionNumber_key" ON "qc_inspections"("tenantId", "inspectionNumber");
CREATE INDEX "qc_inspections_tenantId_status_idx" ON "qc_inspections"("tenantId", "status");

CREATE INDEX "qc_inspection_results_inspectionId_idx" ON "qc_inspection_results"("inspectionId");

CREATE UNIQUE INDEX "ncr_reports_tenantId_ncrNumber_key" ON "ncr_reports"("tenantId", "ncrNumber");
CREATE INDEX "ncr_reports_tenantId_status_idx" ON "ncr_reports"("tenantId", "status");

CREATE UNIQUE INDEX "employees_tenantId_employeeCode_key" ON "employees"("tenantId", "employeeCode");
CREATE UNIQUE INDEX "employees_tenantId_userId_key" ON "employees"("tenantId", "userId");
CREATE INDEX "employees_tenantId_status_idx" ON "employees"("tenantId", "status");

CREATE UNIQUE INDEX "leave_types_tenantId_code_key" ON "leave_types"("tenantId", "code");

CREATE UNIQUE INDEX "leave_balances_employeeId_leaveTypeId_year_key" ON "leave_balances"("employeeId", "leaveTypeId", "year");

CREATE INDEX "leave_requests_tenantId_employeeId_startDate_idx" ON "leave_requests"("tenantId", "employeeId", "startDate");
CREATE INDEX "leave_requests_tenantId_status_idx" ON "leave_requests"("tenantId", "status");

CREATE UNIQUE INDEX "payroll_runs_tenantId_year_month_key" ON "payroll_runs"("tenantId", "year", "month");

CREATE INDEX "payroll_lines_payrollRunId_idx" ON "payroll_lines"("payrollRunId");

CREATE INDEX "workflow_definitions_tenantId_triggerEntity_triggerEvent_idx" ON "workflow_definitions"("tenantId", "triggerEntity", "triggerEvent");

CREATE UNIQUE INDEX "workflow_steps_definitionId_stepNumber_key" ON "workflow_steps"("definitionId", "stepNumber");

CREATE INDEX "workflow_instances_tenantId_status_idx" ON "workflow_instances"("tenantId", "status");

CREATE INDEX "workflow_actions_instanceId_idx" ON "workflow_actions"("instanceId");

CREATE INDEX "notifications_tenantId_userId_isRead_idx" ON "notifications"("tenantId", "userId", "isRead");

CREATE UNIQUE INDEX "notification_preferences_tenantId_userId_category_key" ON "notification_preferences"("tenantId", "userId", "category");

-- ════════════════════════════════════════════════════════════════════
-- 3) Foreign keys (child tables)
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE "qc_inspection_results" ADD CONSTRAINT "qc_inspection_results_inspectionId_fkey"
    FOREIGN KEY ("inspectionId") REFERENCES "qc_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payrollRunId_fkey"
    FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "workflow_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_instanceId_fkey"
    FOREIGN KEY ("instanceId") REFERENCES "workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
-- 4) Row-Level Security (parity with batch 3 review fixes)
--    app_current_tenant_id() already exists from migration 20260611120000.
-- ════════════════════════════════════════════════════════════════════

-- ---- Tables with a direct "tenantId" column ----
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'work_orders', 'qc_inspections', 'ncr_reports',
    'employees', 'leave_types', 'leave_balances', 'leave_requests',
    'payroll_runs', 'workflow_definitions', 'workflow_instances',
    'notifications', 'notification_preferences'
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

ALTER TABLE "qc_inspection_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "qc_inspection_results" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "qc_inspection_results";
CREATE POLICY tenant_isolation ON "qc_inspection_results"
  USING (app_current_tenant_id() IS NULL OR "inspectionId" IN
    (SELECT id FROM qc_inspections WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "inspectionId" IN
    (SELECT id FROM qc_inspections WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payroll_lines";
CREATE POLICY tenant_isolation ON "payroll_lines"
  USING (app_current_tenant_id() IS NULL OR "payrollRunId" IN
    (SELECT id FROM payroll_runs WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "payrollRunId" IN
    (SELECT id FROM payroll_runs WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "workflow_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_steps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_steps";
CREATE POLICY tenant_isolation ON "workflow_steps"
  USING (app_current_tenant_id() IS NULL OR "definitionId" IN
    (SELECT id FROM workflow_definitions WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "definitionId" IN
    (SELECT id FROM workflow_definitions WHERE "tenantId" = app_current_tenant_id()));

ALTER TABLE "workflow_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_actions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "workflow_actions";
CREATE POLICY tenant_isolation ON "workflow_actions"
  USING (app_current_tenant_id() IS NULL OR "instanceId" IN
    (SELECT id FROM workflow_instances WHERE "tenantId" = app_current_tenant_id()))
  WITH CHECK (app_current_tenant_id() IS NULL OR "instanceId" IN
    (SELECT id FROM workflow_instances WHERE "tenantId" = app_current_tenant_id()));
