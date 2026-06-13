import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PERMISSIONS = [
  // ORG
  { code: 'org:tenant:read', module: 'ORG', description: 'View tenant info' },
  {
    code: 'org:tenant:update',
    module: 'ORG',
    description: 'Update tenant settings',
  },
  { code: 'org:branch:create', module: 'ORG', description: 'Create branch' },
  { code: 'org:branch:read', module: 'ORG', description: 'View branches' },
  { code: 'org:branch:update', module: 'ORG', description: 'Update branch' },
  { code: 'org:branch:delete', module: 'ORG', description: 'Delete branch' },
  // UAM
  { code: 'uam:user:create', module: 'UAM', description: 'Invite users' },
  { code: 'uam:user:read', module: 'UAM', description: 'View users' },
  { code: 'uam:user:update', module: 'UAM', description: 'Update user' },
  { code: 'uam:user:delete', module: 'UAM', description: 'Deactivate user' },
  { code: 'uam:role:create', module: 'UAM', description: 'Create custom role' },
  { code: 'uam:role:read', module: 'UAM', description: 'View roles' },
  { code: 'uam:role:update', module: 'UAM', description: 'Update role' },
  { code: 'uam:role:delete', module: 'UAM', description: 'Delete role' },
  { code: 'uam:audit:read', module: 'UAM', description: 'View audit logs' },
  // Platform Admin
  {
    code: 'platform:tenant:create',
    module: 'ADM',
    description: 'Create tenant',
  },
  {
    code: 'platform:tenant:suspend',
    module: 'ADM',
    description: 'Suspend tenant',
  },
  {
    code: 'platform:tenant:read_all',
    module: 'ADM',
    description: 'View all tenants',
  },
  // PUR (Procurement) — Batch 3
  {
    code: 'pur:supplier:create',
    module: 'PUR',
    description: 'Create supplier',
  },
  { code: 'pur:supplier:read', module: 'PUR', description: 'View suppliers' },
  {
    code: 'pur:supplier:update',
    module: 'PUR',
    description: 'Update supplier',
  },
  {
    code: 'pur:supplier:delete',
    module: 'PUR',
    description: 'Deactivate supplier',
  },
  {
    code: 'pur:po:create',
    module: 'PUR',
    description: 'Create purchase order',
  },
  { code: 'pur:po:read', module: 'PUR', description: 'View purchase orders' },
  {
    code: 'pur:po:update',
    module: 'PUR',
    description: 'Update draft purchase order',
  },
  {
    code: 'pur:po:delete',
    module: 'PUR',
    description: 'Delete draft purchase order',
  },
  {
    code: 'pur:po:approve',
    module: 'PUR',
    description: 'Approve purchase order',
  },
  {
    code: 'pur:po:cancel',
    module: 'PUR',
    description: 'Cancel purchase order',
  },
  {
    code: 'pur:grn:create',
    module: 'PUR',
    description: 'Create goods receipt',
  },
  { code: 'pur:grn:read', module: 'PUR', description: 'View goods receipts' },
  // SAL (Sales) — Batch 3
  {
    code: 'sal:customer:create',
    module: 'SAL',
    description: 'Create customer',
  },
  { code: 'sal:customer:read', module: 'SAL', description: 'View customers' },
  {
    code: 'sal:customer:update',
    module: 'SAL',
    description: 'Update customer',
  },
  {
    code: 'sal:customer:delete',
    module: 'SAL',
    description: 'Deactivate customer',
  },
  { code: 'sal:so:create', module: 'SAL', description: 'Create sales order' },
  { code: 'sal:so:read', module: 'SAL', description: 'View sales orders' },
  {
    code: 'sal:so:approve',
    module: 'SAL',
    description: 'Approve credit-held sales order',
  },
  {
    code: 'sal:so:cancel',
    module: 'SAL',
    description: 'Cancel sales order (releases reservation + credit)',
  },
  // FIN (Finance) — Batch 3
  {
    code: 'fin:account:create',
    module: 'FIN',
    description: 'Create / seed accounts',
  },
  {
    code: 'fin:account:read',
    module: 'FIN',
    description: 'View chart of accounts',
  },
  { code: 'fin:account:update', module: 'FIN', description: 'Update account' },
  { code: 'fin:account:delete', module: 'FIN', description: 'Delete account' },
  {
    code: 'fin:period:manage',
    module: 'FIN',
    description: 'Init / close fiscal periods',
  },
  {
    code: 'fin:period:read',
    module: 'FIN',
    description: 'View fiscal periods',
  },
  {
    code: 'fin:journal:create',
    module: 'FIN',
    description: 'Create journal batch',
  },
  {
    code: 'fin:journal:read',
    module: 'FIN',
    description: 'View journal batches',
  },
  {
    code: 'fin:journal:update',
    module: 'FIN',
    description: 'Update draft journal batch',
  },
  {
    code: 'fin:journal:delete',
    module: 'FIN',
    description: 'Delete draft journal batch',
  },
  {
    code: 'fin:journal:post',
    module: 'FIN',
    description: 'Post journal batch',
  },
  {
    code: 'fin:journal:reverse',
    module: 'FIN',
    description: 'Reverse posted journal',
  },
  { code: 'fin:invoice:create', module: 'FIN', description: 'Create invoice' },
  { code: 'fin:invoice:read', module: 'FIN', description: 'View invoices' },
  { code: 'fin:payment:create', module: 'FIN', description: 'Create payment' },
  { code: 'fin:payment:read', module: 'FIN', description: 'View payments' },
  { code: 'fin:payment:post', module: 'FIN', description: 'Post payment' },

  // MFG (Batch 4)
  { code: 'mfg:wo:create', module: 'MFG', description: 'Create work order' },
  { code: 'mfg:wo:read', module: 'MFG', description: 'View work orders' },
  { code: 'mfg:wo:update', module: 'MFG', description: 'Update work order' },
  { code: 'mfg:wo:delete', module: 'MFG', description: 'Delete work order' },
  { code: 'mfg:wo:release', module: 'MFG', description: 'Release work order' },
  { code: 'mfg:wo:execute', module: 'MFG', description: 'Report consumption/output' },
  { code: 'mfg:wo:cancel', module: 'MFG', description: 'Cancel work order' },

  // QC (Batch 4)
  { code: 'qc:inspection:create', module: 'QC', description: 'Create inspection' },
  { code: 'qc:inspection:read', module: 'QC', description: 'View inspections' },
  { code: 'qc:inspection:execute', module: 'QC', description: 'Submit inspection results' },
  { code: 'qc:ncr:create', module: 'QC', description: 'Create NCR report' },
  { code: 'qc:ncr:read', module: 'QC', description: 'View NCR reports' },
  { code: 'qc:ncr:update', module: 'QC', description: 'Update NCR report' },

  // HRM (Batch 4)
  { code: 'hrm:employee:create', module: 'HRM', description: 'Onboard employee' },
  { code: 'hrm:employee:read', module: 'HRM', description: 'View employees' },
  { code: 'hrm:employee:update', module: 'HRM', description: 'Update employee' },
  { code: 'hrm:employee:read_pii', module: 'HRM', description: 'View decrypted PII' },
  { code: 'hrm:leave:create', module: 'HRM', description: 'Submit leave request' },
  { code: 'hrm:leave:read', module: 'HRM', description: 'View leave requests' },
  { code: 'hrm:leave:approve', module: 'HRM', description: 'Approve/reject leave request' },
  { code: 'hrm:leave:manage', module: 'HRM', description: 'Manage leave types & balances' },
  { code: 'hrm:payroll:calculate', module: 'HRM', description: 'Calculate payroll run' },
  { code: 'hrm:payroll:read', module: 'HRM', description: 'View payroll runs' },
  { code: 'hrm:payroll:approve', module: 'HRM', description: 'Approve payroll (auto-journal)' },

  // WFL (Batch 4)
  { code: 'wfl:definition:create', module: 'WFL', description: 'Create workflow definition' },
  { code: 'wfl:definition:read', module: 'WFL', description: 'View workflow definitions' },
  { code: 'wfl:definition:update', module: 'WFL', description: 'Update workflow definition' },
  { code: 'wfl:task:read', module: 'WFL', description: 'View my approval tasks' },
  { code: 'wfl:task:action', module: 'WFL', description: 'Approve/reject workflow task' },
  { code: 'wfl:instance:start', module: 'WFL', description: 'Start a workflow instance' },

  // NTF (Batch 4)
  { code: 'ntf:notification:read', module: 'NTF', description: 'View my notifications' },
  { code: 'ntf:notification:update', module: 'NTF', description: 'Mark notifications read' },
  { code: 'ntf:preference:read', module: 'NTF', description: 'View notification preferences' },
  { code: 'ntf:preference:update', module: 'NTF', description: 'Update notification preferences' },

  // DEL (Batch 5)
  { code: 'sal:dn:create', module: 'DEL', description: 'Create delivery note from SO' },
  { code: 'sal:dn:read', module: 'DEL', description: 'View delivery notes' },
  { code: 'del:picking:manage', module: 'DEL', description: 'Start picking / confirm picked' },
  { code: 'del:packing:manage', module: 'DEL', description: 'Confirm packing' },
  { code: 'del:dispatch:manage', module: 'DEL', description: 'Dispatch / fail / re-dispatch delivery' },
  { code: 'del:pod:submit', module: 'DEL', description: 'Submit proof of delivery' },
  { code: 'del:return:manage', module: 'DEL', description: 'Mark delivery returned' },
  { code: 'del:schedule:read', module: 'DEL', description: 'View delivery schedule' },

  // AST + FIN Reports (Batch 5)
  { code: 'fin:asset:manage', module: 'FIN', description: 'Manage fixed assets + depreciation' },
  { code: 'fin:report:read', module: 'FIN', description: 'Read financial reports' },

  // CRM (Batch 5)
  { code: 'crm:lead:create', module: 'CRM', description: 'Create / update leads' },
  { code: 'crm:lead:read', module: 'CRM', description: 'View leads' },
  { code: 'crm:opportunity:manage', module: 'CRM', description: 'Manage opportunities + convert leads' },
  { code: 'crm:ticket:create', module: 'CRM', description: 'Create support tickets' },
  { code: 'crm:ticket:manage', module: 'CRM', description: 'Manage support tickets' },

  // PMO (Batch 5)
  { code: 'pmo:project:create', module: 'PMO', description: 'Create / update projects' },
  { code: 'pmo:project:read', module: 'PMO', description: 'View projects' },
  { code: 'pmo:task:manage', module: 'PMO', description: 'Manage project tasks' },
  { code: 'pmo:task:read', module: 'PMO', description: 'View project tasks' },
  { code: 'pmo:timesheet:manage', module: 'PMO', description: 'Log / approve timesheets' },
];

const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    maxUsers: 5,
    priceMonthly: 0,
    priceYearly: 0,
  },
  {
    code: 'professional',
    name: 'Professional',
    maxUsers: 25,
    priceMonthly: 2990000,
    priceYearly: 29900000,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    maxUsers: null,
    priceMonthly: 9990000,
    priceYearly: 99900000,
  },
];

async function main() {
  console.log('Seeding permissions...');
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        module: permission.module,
        description: permission.description,
      },
      create: permission,
    });
  }
  console.log(`  ✓ ${PERMISSIONS.length} permissions seeded`);

  // Backfill: tenants registered before this batch only received the
  // permissions that existed at registration time. Re-grant the full catalog
  // to every tenant's owner system role (idempotent via skipDuplicates).
  console.log('Backfilling owner-role permissions for existing tenants...');
  const allPermissions = await prisma.permission.findMany({ select: { id: true } });
  const ownerRoles = await prisma.role.findMany({
    where: { name: 'tenant_owner', isSystem: true },
    select: { id: true },
  });
  for (const role of ownerRoles) {
    await prisma.rolePermission.createMany({
      data: allPermissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }
  console.log(`  ✓ ${ownerRoles.length} owner roles backfilled`);

  console.log('Seeding plans...');
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        maxUsers: plan.maxUsers,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
      },
      create: plan,
    });
  }
  console.log(`  ✓ ${PLANS.length} plans seeded`);

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
