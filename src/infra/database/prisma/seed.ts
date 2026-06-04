import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const PERMISSIONS = [
  // ORG
  { code: 'org:tenant:read', module: 'ORG', description: 'View tenant info' },
  { code: 'org:tenant:update', module: 'ORG', description: 'Update tenant settings' },
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
  { code: 'platform:tenant:create', module: 'ADM', description: 'Create tenant' },
  { code: 'platform:tenant:suspend', module: 'ADM', description: 'Suspend tenant' },
  { code: 'platform:tenant:read_all', module: 'ADM', description: 'View all tenants' },
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
      update: { module: permission.module, description: permission.description },
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
