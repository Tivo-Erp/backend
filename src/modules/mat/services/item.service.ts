import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { ITEM_FIELD_CONFIG } from '../config/item.field-config.js';
import { ItemRepository } from '../repositories/item.repository.js';
import { CreateItemDto } from '../dto/create-item.dto.js';
import { UpdateItemDto } from '../dto/update-item.dto.js';
import { ItemQueryDto } from '../dto/item-query.dto.js';
import { BulkImportItemsDto, BulkImportResultDto } from '../dto/bulk-import-items.dto.js';

@Injectable()
export class ItemService {
  constructor(private readonly repo: ItemRepository) {}

  async create(tenantId: string, dto: CreateItemDto) {
    if (dto.isBatchTracked && dto.isSerialTracked) {
      throw new BadRequestException('MAT_ITEM_BATCH_SERIAL_CONFLICT');
    }

    const exists = await this.repo.findBySku(tenantId, dto.sku);
    if (exists) throw new ConflictException('MAT_ITEM_SKU_DUPLICATE');

    return this.repo.create(tenantId, dto);
  }

  async findAll(tenantId: string, query: ItemQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(query.fields, userRoles, ITEM_FIELD_CONFIG);
    const { data, total, page, limit } = await this.repo.findAll(tenantId, query, select);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string, userRoles: string[], fields?: string) {
    const select = FieldSelector.buildPrismaSelect(fields, userRoles, ITEM_FIELD_CONFIG);
    const item = await this.repo.findById(tenantId, id, select);
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
    return item;
  }

  async update(tenantId: string, id: string, dto: UpdateItemDto) {
    if (dto.isBatchTracked && dto.isSerialTracked) {
      throw new BadRequestException('MAT_ITEM_BATCH_SERIAL_CONFLICT');
    }

    const item = await this.repo.findById(tenantId, id, { id: true, sku: true });
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');

    if (dto.sku && dto.sku !== (item as any).sku) {
      const conflict = await this.repo.findBySku(tenantId, dto.sku);
      if (conflict && conflict.id !== id) throw new ConflictException('MAT_ITEM_SKU_DUPLICATE');
    }

    return this.repo.update(id, dto);
  }

  async remove(tenantId: string, id: string) {
    const item = await this.repo.findById(tenantId, id, { id: true });
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
    await this.repo.softDelete(id);
  }

  async activate(tenantId: string, id: string) {
    const item = await this.repo.findById(tenantId, id, { id: true, status: true });
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
    if ((item as any).status !== 'draft') {
      throw new BadRequestException('MAT_ITEM_STATUS_INVALID_TRANSITION');
    }
    return this.repo.activate(id);
  }

  async bulkImport(tenantId: string, dto: BulkImportItemsDto): Promise<BulkImportResultDto> {
    const valid: typeof dto.items = [];
    const errors: string[] = [];

    for (const item of dto.items) {
      if (item.isBatchTracked && item.isSerialTracked) {
        errors.push(`SKU ${item.sku}: batch and serial cannot both be true`);
      } else {
        valid.push(item);
      }
    }

    let imported = 0;
    let skipped = errors.length;

    if (valid.length > 0) {
      try {
        await this.repo.upsertBulk(tenantId, valid);
        imported = valid.length;
      } catch (err: any) {
        // Per-item errors: re-process one-by-one to collect individual failures
        for (const item of valid) {
          try {
            await this.repo.upsertBulk(tenantId, [item]);
            imported++;
          } catch (e: any) {
            errors.push(`SKU ${item.sku}: ${e.message}`);
            skipped++;
          }
        }
      }
    }

    return { imported, skipped, errors };
  }
}
