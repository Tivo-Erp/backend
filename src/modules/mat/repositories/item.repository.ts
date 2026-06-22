import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { CreateItemDto } from '../dto/create-item.dto.js';
import { UpdateItemDto } from '../dto/update-item.dto.js';
import { ItemQueryDto } from '../dto/item-query.dto.js';
import { BulkImportItemDto } from '../dto/bulk-import-items.dto.js';

@Injectable()
export class ItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySku(tenantId: string, sku: string) {
    return this.prisma.item.findFirst({
      where: { tenantId, sku, deletedAt: null },
    });
  }

  async create(tenantId: string, dto: CreateItemDto) {
    const { customAttributes, ...rest } = dto;
    const data: Prisma.ItemUncheckedCreateInput = {
      tenantId,
      ...rest,
      ...(customAttributes !== undefined && {
        customAttributes: customAttributes as Prisma.InputJsonValue,
      }),
    };
    return this.prisma.item.create({ data });
  }

  async findAll(
    tenantId: string,
    query: ItemQueryDto,
    select: Prisma.ItemSelect,
  ) {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      status,
      itemType,
      categoryId,
      search,
      isPurchasable,
      isSellable,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ItemWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status && { status }),
      ...(itemType && { itemType }),
      ...(categoryId && { categoryId }),
      ...(isPurchasable !== undefined && { isPurchasable }),
      ...(isSellable !== undefined && { isSellable }),
      ...(search && {
        OR: [
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy: Prisma.ItemOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [data, total] = await Promise.all([
      this.prisma.item.findMany({
        where,
        select,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.item.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string, select: Prisma.ItemSelect) {
    return this.prisma.item.findFirst({
      where: { id, tenantId, deletedAt: null },
      select,
    });
  }

  async update(id: string, dto: UpdateItemDto) {
    const { customAttributes, ...rest } = dto;
    const data: Prisma.ItemUncheckedUpdateInput = {
      ...rest,
      ...(customAttributes !== undefined && {
        customAttributes: customAttributes as Prisma.InputJsonValue,
      }),
    };
    return this.prisma.item.update({ where: { id }, data });
  }

  async softDelete(id: string) {
    return this.prisma.item.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async activate(id: string) {
    return this.prisma.item.update({
      where: { id },
      data: { status: 'active' },
    });
  }

  async upsertBulk(tenantId: string, items: BulkImportItemDto[]) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.item.upsert({
          where: { tenantId_sku: { tenantId, sku: item.sku } },
          update: item,
          create: { tenantId, ...item },
        }),
      ),
    );
  }
}
