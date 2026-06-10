-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "maxUsers" INTEGER,
    "priceMonthly" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "priceYearly" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "featureKey" VARCHAR(100) NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "legalName" VARCHAR(255),
    "taxCode" VARCHAR(20),
    "logoUrl" TEXT,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'vi-VN',
    "baseCurrency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'trialing',
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" TEXT,
    "city" VARCHAR(100),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "isHeadquarters" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "avatarUrl" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'invited',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" VARCHAR(255),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" VARCHAR(45),
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "action" VARCHAR(50) NOT NULL,
    "module" VARCHAR(50) NOT NULL,
    "entityType" VARCHAR(100),
    "entityId" UUID,
    "changes" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "documentType" VARCHAR(20) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "separator" VARCHAR(5) NOT NULL DEFAULT '-',
    "includeYear" BOOLEAN NOT NULL DEFAULT true,
    "yearFormat" VARCHAR(10) NOT NULL DEFAULT 'YYYY',
    "padding" INTEGER NOT NULL DEFAULT 5,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "lastResetYear" INTEGER,
    "resetYearly" BOOLEAN NOT NULL DEFAULT true,
    "branchId" UUID,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_categories" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sku" VARCHAR(100) NOT NULL,
    "name" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "categoryId" UUID,
    "itemType" VARCHAR(30) NOT NULL,
    "baseUom" VARCHAR(20) NOT NULL,
    "weight" DECIMAL(10,4),
    "isBatchTracked" BOOLEAN NOT NULL DEFAULT false,
    "isSerialTracked" BOOLEAN NOT NULL DEFAULT false,
    "isPurchasable" BOOLEAN NOT NULL DEFAULT true,
    "isSellable" BOOLEAN NOT NULL DEFAULT true,
    "minStockLevel" DECIMAL(15,4),
    "safetyStock" DECIMAL(15,4),
    "leadTimeDays" INTEGER,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "customAttributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boms" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" UUID NOT NULL,
    "bomId" UUID NOT NULL,
    "componentItemId" UUID NOT NULL,
    "quantityPerUnit" DECIMAL(15,6) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "scrapPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "branchId" UUID,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "zoneType" VARCHAR(30) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bins" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "barcode" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100),
    "binType" VARCHAR(20) NOT NULL,
    "maxWeightKg" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "variantId" UUID,
    "binId" UUID,
    "lotId" UUID,
    "quantityOnHand" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "quantityReserved" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "costPerUnit" DECIMAL(15,4) NOT NULL DEFAULT 0,
    "uom" VARCHAR(20) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "movementType" VARCHAR(30) NOT NULL,
    "direction" VARCHAR(3) NOT NULL,
    "quantity" DECIMAL(15,4) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "costPerUnit" DECIMAL(15,4),
    "referenceType" VARCHAR(50),
    "referenceId" UUID,
    "binId" UUID,
    "lotId" UUID,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "lotNumber" VARCHAR(100) NOT NULL,
    "itemId" UUID NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_planId_featureKey_key" ON "plan_features"("planId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenantId_code_key" ON "branches"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenantId_name_key" ON "roles"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_module_idx" ON "audit_logs"("tenantId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_tenantId_documentType_branchId_key" ON "document_sequences"("tenantId", "documentType", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "item_categories_tenantId_name_key" ON "item_categories"("tenantId", "name");

-- CreateIndex
CREATE INDEX "items_tenantId_status_idx" ON "items"("tenantId", "status");

-- CreateIndex
CREATE INDEX "items_tenantId_itemType_idx" ON "items"("tenantId", "itemType");

-- CreateIndex
CREATE UNIQUE INDEX "items_tenantId_sku_key" ON "items"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "boms_tenantId_itemId_version_key" ON "boms"("tenantId", "itemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenantId_code_key" ON "warehouses"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "zones_warehouseId_code_key" ON "zones"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bins_zoneId_barcode_key" ON "bins"("zoneId", "barcode");

-- CreateIndex
CREATE INDEX "inventory_balances_tenantId_warehouseId_idx" ON "inventory_balances"("tenantId", "warehouseId");

-- CreateIndex
CREATE INDEX "inventory_balances_tenantId_itemId_idx" ON "inventory_balances"("tenantId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_tenantId_itemId_warehouseId_variantId_bi_key" ON "inventory_balances"("tenantId", "itemId", "warehouseId", "variantId", "binId", "lotId");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_itemId_createdAt_idx" ON "stock_movements"("tenantId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_warehouseId_createdAt_idx" ON "stock_movements"("tenantId", "warehouseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lots_tenantId_lotNumber_key" ON "lots"("tenantId", "lotNumber");

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
