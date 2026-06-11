import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';

const SUPPLIER_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'code',
  'name',
] as const;
import {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from '../dto/supplier.dto.js';

@Injectable()
export class SupplierRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(tenantId: string, code: string) {
    return this.prisma.supplier.findFirst({ where: { tenantId, code } });
  }

  async create(tenantId: string, dto: CreateSupplierDto) {
    return this.prisma.supplier.create({ data: { tenantId, ...dto } });
  }

  async findAll(
    tenantId: string,
    query: SupplierQueryDto,
    select: Record<string, any>,
  ) {
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      search,
      isActive,
    } = query;
    const sortBy = safeSortBy(query.sortBy, SUPPLIER_SORTABLE_FIELDS);
    const where: any = {
      tenantId,
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string, select: Record<string, any>) {
    return this.prisma.supplier.findFirst({ where: { id, tenantId }, select });
  }

  async update(id: string, dto: UpdateSupplierDto) {
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }
}
