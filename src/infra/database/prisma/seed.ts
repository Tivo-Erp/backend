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
