import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    select?: Prisma.BranchSelect,
  ) {
    const where: Prisma.BranchWhereInput = { tenantId };
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.BranchOrderByWithRelationInput = {
      [query.sortBy || 'createdAt']: query.sortOrder || 'desc',
    };
    const skip = ((query.page || 1) - 1) * (query.limit || 20);
    const take = query.limit || 20;

    const [data, total] = await Promise.all([
      // Sparse Fieldsets: push select down to DB (no SELECT *)
      this.prisma.branch.findMany({ where, skip, take, orderBy, select }),
      this.prisma.branch.count({ where }),
    ]);

    return { data, total };
  }

  async create(data: Prisma.BranchUncheckedCreateInput) {
    return this.prisma.branch.create({ data });
  }

  async update(id: string, data: Prisma.BranchUpdateInput) {
    return this.prisma.branch.update({ where: { id }, data });
  }

  async countWarehouses(branchId: string) {
    return this.prisma.warehouse.count({ where: { branchId } });
  }

  async delete(id: string) {
    return this.prisma.branch.delete({ where: { id } });
  }
}
