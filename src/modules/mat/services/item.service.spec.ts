import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ItemService } from './item.service.js';
import { ItemRepository } from '../repositories/item.repository.js';
import { CacheService } from '../../../infra/cache/cache.service.js';

const mockRepo = () => ({
  findBySku: jest.fn(),
  create: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
  activate: jest.fn(),
  upsertBulk: jest.fn(),
});

describe('ItemService', () => {
  let service: ItemService;
  let repo: ReturnType<typeof mockRepo>;

  const tenantId = 'tenant-uuid';
  const itemId = 'item-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemService,
        { provide: ItemRepository, useFactory: mockRepo },
        {
          provide: CacheService,
          useValue: {
            key: jest.fn().mockReturnValue('k'),
            // wrap must run the loader so cache-aside is transparent in tests.
            wrap: jest.fn((_k: string, _ttl: number, loader: () => any) =>
              loader(),
            ),
            invalidateNamespace: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ItemService);
    repo = module.get(ItemRepository);
  });

  // ── create ────────────────────────────────────────────────────

  describe('create', () => {
    const dto: any = {
      sku: 'SKU-001',
      name: 'Widget',
      itemType: 'product',
      baseUom: 'PCS',
    };

    it('creates item when SKU is unique', async () => {
      repo.findBySku.mockResolvedValue(null);
      repo.create.mockResolvedValue({ id: itemId, ...dto });

      const result = await service.create(tenantId, dto);

      expect(repo.findBySku).toHaveBeenCalledWith(tenantId, dto.sku);
      expect(repo.create).toHaveBeenCalledWith(tenantId, dto);
      expect(result.id).toBe(itemId);
    });

    it('throws 409 when SKU already exists', async () => {
      repo.findBySku.mockResolvedValue({ id: 'other' });
      await expect(service.create(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 400 when both isBatchTracked and isSerialTracked are true', async () => {
      const conflictDto = {
        ...dto,
        isBatchTracked: true,
        isSerialTracked: true,
      };
      await expect(service.create(tenantId, conflictDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.findBySku).not.toHaveBeenCalled();
    });
  });

  // ── findAll ───────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated response', async () => {
      repo.findAll.mockResolvedValue({
        data: [{ id: itemId }],
        total: 1,
        page: 1,
        limit: 20,
      });

      const query: any = { page: 1, limit: 20 };
      const result = await service.findAll(tenantId, query, ['admin']);

      expect(repo.findAll).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta.totalItems).toBe(1);
    });
  });

  // ── findOne ───────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns item when found', async () => {
      repo.findById.mockResolvedValue({ id: itemId });
      const result = await service.findOne(tenantId, itemId, ['viewer']);
      expect(result.id).toBe(itemId);
    });

    it('throws 404 when item not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.findOne(tenantId, itemId, ['viewer']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ────────────────────────────────────────────────────

  describe('update', () => {
    it('updates item', async () => {
      repo.findById.mockResolvedValue({ id: itemId, sku: 'SKU-001' });
      repo.update.mockResolvedValue({ id: itemId, name: 'Updated' });

      const result = await service.update(tenantId, itemId, {
        name: 'Updated',
      });
      expect(result.name).toBe('Updated');
    });

    it('throws 404 when item not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update(tenantId, itemId, {} as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 409 on SKU conflict with different item', async () => {
      repo.findById.mockResolvedValue({ id: itemId, sku: 'SKU-OLD' });
      repo.findBySku.mockResolvedValue({ id: 'other-id' });

      await expect(
        service.update(tenantId, itemId, { sku: 'SKU-NEW' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('allows SKU update when it belongs to same item', async () => {
      repo.findById.mockResolvedValue({ id: itemId, sku: 'SKU-OLD' });
      repo.findBySku.mockResolvedValue({ id: itemId });
      repo.update.mockResolvedValue({ id: itemId, sku: 'SKU-NEW' });

      const result = await service.update(tenantId, itemId, {
        sku: 'SKU-NEW',
      });
      expect(result.sku).toBe('SKU-NEW');
    });

    it('throws 400 on batch+serial conflict', async () => {
      repo.findById.mockResolvedValue({ id: itemId, sku: 'SKU-001' });
      await expect(
        service.update(tenantId, itemId, {
          isBatchTracked: true,
          isSerialTracked: true,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── remove ────────────────────────────────────────────────────

  describe('remove', () => {
    it('soft-deletes item', async () => {
      repo.findById.mockResolvedValue({ id: itemId });
      await service.remove(tenantId, itemId);
      expect(repo.softDelete).toHaveBeenCalledWith(itemId);
    });

    it('throws 404 when item not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.remove(tenantId, itemId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── activate ──────────────────────────────────────────────────

  describe('activate', () => {
    it('activates a draft item', async () => {
      repo.findById.mockResolvedValue({ id: itemId, status: 'draft' });
      repo.activate.mockResolvedValue({ id: itemId, status: 'active' });

      const result = await service.activate(tenantId, itemId);
      expect(result.status).toBe('active');
    });

    it('throws 400 when item is not in draft status', async () => {
      repo.findById.mockResolvedValue({ id: itemId, status: 'active' });
      await expect(service.activate(tenantId, itemId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws 404 when item not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.activate(tenantId, itemId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── bulkImport ────────────────────────────────────────────────

  describe('bulkImport', () => {
    const makeDto = (items: any[]) => ({ items });

    it('imports all valid items in one batch call', async () => {
      const items = [
        { sku: 'A', name: 'A', itemType: 'product', baseUom: 'PCS' },
        { sku: 'B', name: 'B', itemType: 'product', baseUom: 'PCS' },
      ];
      repo.upsertBulk.mockResolvedValue([]);

      const result = await service.bulkImport(tenantId, makeDto(items));

      expect(repo.upsertBulk).toHaveBeenCalledTimes(1);
      expect(repo.upsertBulk).toHaveBeenCalledWith(tenantId, items);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('skips items with batch+serial conflict before batch call', async () => {
      const items = [
        {
          sku: 'A',
          isBatchTracked: true,
          isSerialTracked: true,
          name: 'A',
          itemType: 'product',
          baseUom: 'PCS',
        },
        { sku: 'B', name: 'B', itemType: 'product', baseUom: 'PCS' },
      ];
      repo.upsertBulk.mockResolvedValue([]);

      const result = await service.bulkImport(tenantId, makeDto(items));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors[0]).toContain('SKU A');
    });

    it('falls back to per-item on batch failure and reports individual errors', async () => {
      const items = [
        { sku: 'A', name: 'A', itemType: 'product', baseUom: 'PCS' },
        { sku: 'B', name: 'B', itemType: 'product', baseUom: 'PCS' },
      ];
      repo.upsertBulk
        .mockRejectedValueOnce(new Error('batch failed'))
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('SKU B conflict'));

      const result = await service.bulkImport(tenantId, makeDto(items));

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors[0]).toContain('SKU B');
    });
  });
});
