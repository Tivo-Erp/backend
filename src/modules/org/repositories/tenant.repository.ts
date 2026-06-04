import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string) {
    return this.prisma.tenant.findUnique({ where: { slug } });
  }

  async findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }

  async findWithSubscription(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async update(tenantId: string, data: Record<string, unknown>) {
    return this.prisma.tenant.update({ where: { id: tenantId }, data });
  }
}
