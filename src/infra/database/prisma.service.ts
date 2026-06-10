import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async setTenantContext(tenantId: string) {
    // Validate UUID format to prevent SQL injection via raw string interpolation
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new Error(`Invalid tenantId format: ${tenantId}`);
    }
    // Use SET (session-level) not SET LOCAL: SET LOCAL reverts immediately when
    // called outside a transaction (auto-commit mode), so RLS would never apply.
    // SET persists for the connection lifetime; TenantGuard overwrites it on every request.
    await this.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
  }
}



