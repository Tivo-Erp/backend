import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';

@Injectable()
export class BranchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTenantAndCode(tenantId: string, code: string) {
    return this.prisma.branch.findUnique({
      where: { tenantId_code: { tenantId, code } },
    });
  }

  async findById(id: string) {
    return this.prisma.branch.findUnique({ where: { id } });
  }

  async findHeadquarters(tenantId: string) {
    return this.prisma.branch.findFirst({
      where: { tenantId, isHeadquarters: true },
    });
  }

  async findMany(
    tenantId: string,
    query: PaginationQueryDto & { isActive?: boolean; search?: string },
    select?: Record<string, any>,
  ) {
    const where: any = { tenantId };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const findArgs: any = {
      where,
      skip: ((query.page || 1) - 1) * (query.limit || 20),
      take: query.limit || 20,
      orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
    };

    // Sparse Fieldsets: push select down to DB (no SELECT *)
    if (select) {
      findArgs.select = select;
    }

    const [data, total] = await Promise.all([
      this.prisma.branch.findMany(findArgs),
      this.prisma.branch.count({ where }),
    ]);

    return { data, total };
  }

  async create(data: any) {
    return this.prisma.branch.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.branch.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.prisma.branch.delete({ where: { id } });
  }
}
