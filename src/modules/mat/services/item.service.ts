import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { CacheService } from '../../../infra/cache/cache.service.js';
import { ITEM_FIELD_CONFIG } from '../config/item.field-config.js';
import { ItemRepository } from '../repositories/item.repository.js';
import { CreateItemDto } from '../dto/create-item.dto.js';
import { UpdateItemDto } from '../dto/update-item.dto.js';
import { ItemQueryDto } from '../dto/item-query.dto.js';
import {
  BulkImportItemsDto,
  BulkImportResultDto,
} from '../dto/bulk-import-items.dto.js';

/** Cache namespace for the items master list (INF-007). */
const CACHE_NS = 'mat:items:list';
const CACHE_TTL_SEC = 60;

@Injectable()
export class ItemService {
  constructor(
    private readonly repo: ItemRepository,
    private readonly cache: CacheService,
  ) {}

  async create(tenantId: string, dto: CreateItemDto) {
    if (dto.isBatchTracked && dto.isSerialTracked) {
      throw new BadRequestException('MAT_ITEM_BATCH_SERIAL_CONFLICT');
    }

    const exists = await this.repo.findBySku(tenantId, dto.sku);
    if (exists) throw new ConflictException('MAT_ITEM_SKU_DUPLICATE');

    const created = await this.repo.create(tenantId, dto);
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    return created;
  }

  async findAll(tenantId: string, query: ItemQueryDto, userRoles: string[]) {
    // Field validation (role whitelist) happens BEFORE the cache lookup, so a
    // role without access to a field can never read it from a cached entry.
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      ITEM_FIELD_CONFIG,
    );
    // Key: tenant-scoped (cache.key) + pagination + every filter + sparse
    // fieldset. The items master is tenant-wide (no user/branch scoping).
    const suffix = [
      `p${query.page ?? 1}`,
      `l${query.limit ?? 20}`,
      `sb${query.sortBy ?? 'createdAt'}`,
      `so${query.sortOrder ?? 'desc'}`,
      `st${query.status ?? ''}`,
      `it${query.itemType ?? ''}`,
      `cat${query.categoryId ?? ''}`,
      `q${query.search ?? ''}`,
      `pu${query.isPurchasable ?? ''}`,
      `se${query.isSellable ?? ''}`,
      `f${FieldSelector.toCacheKey(query.fields)}`,
    ].join(':');
    const key = this.cache.key(tenantId, CACHE_NS, suffix);
    return this.cache.wrap(key, CACHE_TTL_SEC, async () => {
      const { data, total, page, limit } = await this.repo.findAll(
        tenantId,
        query,
        select,
      );
      return PaginatedResponseDto.create(data, total, page, limit);
    });
  }

  async findOne(
    tenantId: string,
    id: string,
    userRoles: string[],
    fields?: string,
  ) {
    const select = FieldSelector.buildPrismaSelect(
      fields,
      userRoles,
      ITEM_FIELD_CONFIG,
    );
    const item = await this.repo.findById(tenantId, id, select);
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
    return item;
  }

  async update(tenantId: string, id: string, dto: UpdateItemDto) {
    if (dto.isBatchTracked && dto.isSerialTracked) {
      throw new BadRequestException('MAT_ITEM_BATCH_SERIAL_CONFLICT');
    }

    const item = await this.repo.findById(tenantId, id, {
      id: true,
      sku: true,
    });
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');

    if (dto.sku && dto.sku !== item.sku) {
      const conflict = await this.repo.findBySku(tenantId, dto.sku);
      if (conflict && conflict.id !== id)
        throw new ConflictException('MAT_ITEM_SKU_DUPLICATE');
    }

    const updated = await this.repo.update(id, dto);
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const item = await this.repo.findById(tenantId, id, { id: true });
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
    await this.repo.softDelete(id);
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
  }

  async activate(tenantId: string, id: string) {
    const item = await this.repo.findById(tenantId, id, {
      id: true,
      status: true,
    });
    if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
    if (item.status !== 'draft') {
      throw new BadRequestException('MAT_ITEM_STATUS_INVALID_TRANSITION');
    }
    const activated = await this.repo.activate(id);
    await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    return activated;
  }

  async bulkImport(
    tenantId: string,
    dto: BulkImportItemsDto,
  ): Promise<BulkImportResultDto> {
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
      } catch {
        // Per-item errors: re-process one-by-one to collect individual failures
        for (const item of valid) {
          try {
            await this.repo.upsertBulk(tenantId, [item]);
            imported++;
          } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            errors.push(`SKU ${item.sku}: ${message}`);
            skipped++;
          }
        }
      }
    }

    if (imported > 0) {
      await this.cache.invalidateNamespace(tenantId, CACHE_NS);
    }

    return { imported, skipped, errors };
  }
}
