-- Batch 3 — Procurement, Sales & Finance
-- Suppliers, Customers, Purchase Orders + GRN, Sales Orders, Finance (COA, Periods, Journals, Invoices, Payments)

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "legalName" VARCHAR(255),
    "taxCode" VARCHAR(20),
    "contactName" VARCHAR(200),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "address" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "legalName" VARCHAR(255),
    "taxCode" VARCHAR(20),
    "contactName" VARCHAR(200),
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "address" TEXT,
    "creditLimit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "creditUsed" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "poNumber" VARCHAR(30) NOT NULL,
    "supplierId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "branchId" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" TIMESTAMP(3),
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "subTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "poId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "variantId" UUID,
    "description" VARCHAR(500),
    "quantity" DECIMAL(15,4) NOT NULL,
    "receivedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "unitPrice" DECIMAL(15,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRateId" UUID,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "grnNumber" VARCHAR(30) NOT NULL,
    "poId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "grnId" UUID NOT NULL,
    "poLineId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "receivedQty" DECIMAL(15,4) NOT NULL,
    "binId" UUID,
    "lotId" UUID,
    "uom" VARCHAR(20) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "soNumber" VARCHAR(30) NOT NULL,
    "customerId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "branchId" UUID,
    "status" VARCHAR(30) NOT NULL DEFAULT 'draft',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryDate" TIMESTAMP(3),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "subTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" UUID NOT NULL,
    "soId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "variantId" UUID,
    "quantity" DECIMAL(15,4) NOT NULL,
    "shippedQty" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "unitPrice" DECIMAL(15,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxRateId" UUID,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(15,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountCode" VARCHAR(20) NOT NULL,
    "accountName" VARCHAR(255) NOT NULL,
    "accountType" VARCHAR(20) NOT NULL,
    "parentCode" VARCHAR(20),
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "normalBalance" VARCHAR(10) NOT NULL,

    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "closedAt" TIMESTAMP(3),
    "closedBy" UUID,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_batches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "batchNumber" VARCHAR(30) NOT NULL,
    "description" TEXT,
    "reference" VARCHAR(50),
    "journalDate" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "sourceType" VARCHAR(30) NOT NULL,
    "sourceId" UUID,
    "totalDebit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "reversalOf" UUID,
    "postedBy" UUID,
    "postedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "accountCode" VARCHAR(20) NOT NULL,
    "description" VARCHAR(500),
    "debitAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "costCenterId" UUID,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "exchangeRate" DECIMAL(10,4) NOT NULL DEFAULT 1,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceNumber" VARCHAR(30) NOT NULL,
    "invoiceType" VARCHAR(10) NOT NULL,
    "partyId" UUID NOT NULL,
    "partyType" VARCHAR(20) NOT NULL,
    "sourceId" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "subTotal" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(15,2) NOT NULL,
    "amountPaid" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "balanceDue" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paymentNumber" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "counterpartyId" UUID NOT NULL,
    "counterpartyType" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "allocatedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "paymentMethod" VARCHAR(20) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "bankReference" VARCHAR(100),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "journalBatchId" UUID,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "allocatedAmount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_code_key" ON "suppliers"("tenantId", "code");
CREATE UNIQUE INDEX "customers_tenantId_code_key" ON "customers"("tenantId", "code");

CREATE UNIQUE INDEX "purchase_orders_tenantId_poNumber_key" ON "purchase_orders"("tenantId", "poNumber");
CREATE INDEX "purchase_orders_tenantId_status_idx" ON "purchase_orders"("tenantId", "status");
CREATE INDEX "purchase_order_lines_poId_idx" ON "purchase_order_lines"("poId");

CREATE UNIQUE INDEX "goods_receipts_tenantId_grnNumber_key" ON "goods_receipts"("tenantId", "grnNumber");
CREATE INDEX "goods_receipts_tenantId_poId_idx" ON "goods_receipts"("tenantId", "poId");
CREATE INDEX "goods_receipt_lines_grnId_idx" ON "goods_receipt_lines"("grnId");

CREATE UNIQUE INDEX "sales_orders_tenantId_soNumber_key" ON "sales_orders"("tenantId", "soNumber");
CREATE INDEX "sales_orders_tenantId_status_idx" ON "sales_orders"("tenantId", "status");
CREATE INDEX "sales_order_lines_soId_idx" ON "sales_order_lines"("soId");

CREATE UNIQUE INDEX "chart_of_accounts_tenantId_accountCode_key" ON "chart_of_accounts"("tenantId", "accountCode");
CREATE INDEX "chart_of_accounts_tenantId_accountType_idx" ON "chart_of_accounts"("tenantId", "accountType");

CREATE UNIQUE INDEX "fiscal_periods_tenantId_year_month_key" ON "fiscal_periods"("tenantId", "year", "month");

CREATE UNIQUE INDEX "journal_batches_tenantId_batchNumber_key" ON "journal_batches"("tenantId", "batchNumber");
CREATE INDEX "journal_batches_tenantId_journalDate_idx" ON "journal_batches"("tenantId", "journalDate");
CREATE INDEX "journal_entries_batchId_idx" ON "journal_entries"("batchId");

CREATE UNIQUE INDEX "invoices_tenantId_invoiceNumber_key" ON "invoices"("tenantId", "invoiceNumber");
CREATE INDEX "invoices_tenantId_partyId_idx" ON "invoices"("tenantId", "partyId");
CREATE INDEX "invoices_tenantId_status_idx" ON "invoices"("tenantId", "status");

CREATE UNIQUE INDEX "payments_tenantId_paymentNumber_key" ON "payments"("tenantId", "paymentNumber");
CREATE INDEX "payments_tenantId_counterpartyId_idx" ON "payments"("tenantId", "counterpartyId");

CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_poId_fkey" FOREIGN KEY ("poId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_soId_fkey" FOREIGN KEY ("soId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "journal_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
