import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WarehouseService } from './warehouse.service.js';
import { WarehouseRepository } from '../repositories/warehouse.repository.js';

const mockRepo = () => ({
  findWarehouseByCode: jest.fn(),
  createWarehouse: jest.fn(),
  findAllWarehouses: jest.fn(),
  findWarehouseById: jest.fn(),
  updateWarehouse: jest.fn(),
  hasStock: jest.fn(),
  deleteWarehouse: jest.fn(),
  assertWarehouseOwnership: jest.fn(),
  findZoneByCode: jest.fn(),
  createZone: jest.fn(),
  findZones: jest.fn(),
  assertZoneOwnership: jest.fn(),
  updateZone: jest.fn(),
  deleteZone: jest.fn(),
  findBinByBarcode: jest.fn(),
  createBin: jest.fn(),
  findBins: jest.fn(),
  findBinById: jest.fn(),
  updateBin: jest.fn(),
  deleteBin: jest.fn(),
});

describe('WarehouseService', () => {
  let service: WarehouseService;
  let repo: ReturnType<typeof mockRepo>;

  const tenantId    = 'tenant-uuid';
  const warehouseId = 'wh-uuid';
  const zoneId      = 'zone-uuid';
  const binId       = 'bin-uuid';
  const roles       = ['admin'];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehouseService,
        { provide: WarehouseRepository, useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(WarehouseService);
    repo    = module.get(WarehouseRepository);
  });

  // ── createWarehouse ───────────────────────────────────────────

  describe('createWarehouse', () => {
    const dto: any = { code: 'WH-HN', name: 'Hanoi' };

    it('creates warehouse when code is unique', async () => {
      repo.findWarehouseByCode.mockResolvedValue(null);
      repo.createWarehouse.mockResolvedValue({ id: warehouseId, ...dto });

      const result = await service.createWarehouse(tenantId, dto);
      expect(result.id).toBe(warehouseId);
    });

    it('throws 409 when code already exists', async () => {
      repo.findWarehouseByCode.mockResolvedValue({ id: 'other' });
      await expect(service.createWarehouse(tenantId, dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── findAllWarehouses ─────────────────────────────────────────

  describe('findAllWarehouses', () => {
    it('returns list with sparse fieldsets applied', async () => {
      repo.findAllWarehouses.mockResolvedValue([{ id: warehouseId, code: 'WH-HN' }]);
      const result = await service.findAllWarehouses(tenantId, roles);
      expect(repo.findAllWarehouses).toHaveBeenCalledWith(tenantId, expect.any(Object));
      expect(result).toHaveLength(1);
    });
  });

  // ── findWarehouseById ─────────────────────────────────────────

  describe('findWarehouseById', () => {
    it('returns warehouse with zones and bins', async () => {
      repo.findWarehouseById.mockResolvedValue({ id: warehouseId, zones: [] });
      const result = await service.findWarehouseById(tenantId, warehouseId);
      expect(result.id).toBe(warehouseId);
    });

    it('throws 404 when not found', async () => {
      repo.findWarehouseById.mockResolvedValue(null);
      await expect(service.findWarehouseById(tenantId, warehouseId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteWarehouse ───────────────────────────────────────────

  describe('deleteWarehouse', () => {
    it('deletes warehouse when no stock exists', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.hasStock.mockResolvedValue(null);

      await service.deleteWarehouse(tenantId, warehouseId);
      expect(repo.deleteWarehouse).toHaveBeenCalledWith(warehouseId);
    });

    it('throws 409 when warehouse has stock', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.hasStock.mockResolvedValue({ id: 'balance-1' });

      await expect(service.deleteWarehouse(tenantId, warehouseId)).rejects.toThrow(ConflictException);
    });

    it('throws 404 when warehouse not found', async () => {
      repo.assertWarehouseOwnership.mockRejectedValue(new NotFoundException('WMS_WAREHOUSE_NOT_FOUND'));
      await expect(service.deleteWarehouse(tenantId, warehouseId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── createZone ────────────────────────────────────────────────

  describe('createZone', () => {
    const dto: any = { code: 'ZONE-A', name: 'Zone A', zoneType: 'pick' };

    it('creates zone when code is unique', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.findZoneByCode.mockResolvedValue(null);
      repo.createZone.mockResolvedValue({ id: zoneId, ...dto });

      const result = await service.createZone(tenantId, warehouseId, dto);
      expect(result.id).toBe(zoneId);
    });

    it('throws 409 when zone code duplicate', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.findZoneByCode.mockResolvedValue({ id: 'other' });

      await expect(service.createZone(tenantId, warehouseId, dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── createBin ─────────────────────────────────────────────────

  describe('createBin', () => {
    const dto: any = { barcode: 'A-01-001', binType: 'pick' };

    it('creates bin when barcode is unique in zone', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.assertZoneOwnership.mockResolvedValue({ id: zoneId });
      repo.findBinByBarcode.mockResolvedValue(null);
      repo.createBin.mockResolvedValue({ id: binId, ...dto });

      const result = await service.createBin(tenantId, warehouseId, zoneId, dto);
      expect(result.id).toBe(binId);
    });

    it('throws 409 when barcode duplicate in zone', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.assertZoneOwnership.mockResolvedValue({ id: zoneId });
      repo.findBinByBarcode.mockResolvedValue({ id: 'other' });

      await expect(service.createBin(tenantId, warehouseId, zoneId, dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── deleteBin ─────────────────────────────────────────────────

  describe('deleteBin', () => {
    it('deletes bin when found', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.assertZoneOwnership.mockResolvedValue({ id: zoneId });
      repo.findBinById.mockResolvedValue({ id: binId });

      await service.deleteBin(tenantId, warehouseId, zoneId, binId);
      expect(repo.deleteBin).toHaveBeenCalledWith(binId);
    });

    it('throws 404 when bin not found', async () => {
      repo.assertWarehouseOwnership.mockResolvedValue({ id: warehouseId });
      repo.assertZoneOwnership.mockResolvedValue({ id: zoneId });
      repo.findBinById.mockResolvedValue(null);

      await expect(service.deleteBin(tenantId, warehouseId, zoneId, binId)).rejects.toThrow(NotFoundException);
    });
  });
});
