import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { currentTenantId } from './tenant-context.js';

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

  /**
   * RLS tenant context. `set_config(..., true)` is transaction-local: it is
   * guaranteed to run on the same connection as the wrapped statements and
   * reverts automatically on commit/rollback, so it can never bleed into
   * another tenant's request through the connection pool (a session-level
   * `SET` can, because each pooled query may run on a different connection).
   *
   * Queries executed outside a transaction therefore run WITHOUT the RLS
   * context; the policies are written to pass when the setting is absent and
   * app-level `where: { tenantId }` filters remain the primary guard there.
   */
  override $transaction<P extends Prisma.PrismaPromise<any>[]>(
    arg: [...P],
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<{
    [K in keyof P]: P[K] extends Prisma.PrismaPromise<infer R> ? R : never;
  }>;
  override $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<R>;
  override $transaction(arg: any, options?: any): Promise<any> {
    const tenantId = currentTenantId();
    if (!tenantId) {
      return super.$transaction(arg, options);
    }
    if (typeof arg === 'function') {
      return super.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return arg(tx);
      }, options);
    }
    if (Array.isArray(arg)) {
      return super
        .$transaction(
          [
            this
              .$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
            ...arg,
          ],
          options,
        )
        .then((results) => results.slice(1));
    }
    return super.$transaction(arg, options);
  }
}
