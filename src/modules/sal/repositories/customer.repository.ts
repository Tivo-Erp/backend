import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from '../dto/customer.dto.js';

/** Columns the client may sort by — anything else falls back to createdAt. */
const CUSTOMER_SORTABLE_FIELDS = [
  'code',
  'name',
  'email',
  'isActive',
  'paymentTermsDays',
  'createdAt',
  'updatedAt',
] as const;

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(tenantId: string, code: string) {
    return this.prisma.customer.findFirst({ where: { tenantId, code } });
  }

  async create(tenantId: string, dto: CreateCustomerDto) {
    return this.prisma.customer.create({ data: { tenantId, ...dto } });
  }

  async findAll(
    tenantId: string,
    query: CustomerQueryDto,
    select: Prisma.CustomerSelect,
  ) {
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      search,
      isActive,
    } = query;
    const sortBy = safeSortBy(query.sortBy, CUSTOMER_SORTABLE_FIELDS);
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const orderBy: Prisma.CustomerOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string, select: Prisma.CustomerSelect) {
    return this.prisma.customer.findFirst({ where: { id, tenantId }, select });
  }

  /**
   * Tenant-scoped write: updateMany carries the tenantId guard (plain
   * `update({ where: { id } })` would let a leaked id cross tenants), then
   * re-fetches the row for the return value.
   */
  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    await this.prisma.customer.updateMany({
      where: { id, tenantId },
      data: dto,
    });
    return this.prisma.customer.findFirst({ where: { id, tenantId } });
  }
}
