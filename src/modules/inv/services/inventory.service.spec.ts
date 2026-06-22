import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const makePrisma = () => ({
  inventoryBalance: {
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  stockMovement: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
  },
  warehouse: { findFirst: jest.fn() },
  item: { findFirst: jest.fn() },
  $transaction: jest.fn((fn: any) =>
    fn({
      warehouse: { findFirst: jest.fn() },
      item: { findFirst: jest.fn() },
      inventoryBalance: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      stockMovement: { create: jest.fn(), createMany: jest.fn() },
    }),
  ),
});

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: ReturnType<typeof makePrisma>;

  const tenantId = 'tenant-uuid';
  const userId = 'user-uuid';
  const warehouseId = 'wh-uuid';
  const itemId = 'item-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useFactory: makePrisma },
      ],
    }).compile();

    service = module.get(InventoryService);
    prisma = module.get(PrismaService);
  });

  // ── findBalances ──────────────────────────────────────────────

  describe('findBalances', () => {
    const makeBalance = (qoh: number, qres: number, minStock?: number) => ({
      itemId,
      warehouseId,
      quantityOnHand: qoh,
      quantityReserved: qres,
      costPerUnit: 100,
      uom: 'PCS',
      item: { sku: 'SKU-1', name: 'Widget', minStockLevel: minStock ?? null },
      warehouse: { code: 'WH-HN' },
    });

    it('returns paginated balances with computed fields', async () => {
      const balance = makeBalance(100, 20);
      prisma.inventoryBalance.findMany.mockResolvedValue([balance]);
      prisma.inventoryBalance.count.mockResolvedValue(1);

      const result = await service.findBalances(
        tenantId,
        { page: 1, limit: 20 },
        ['admin'],
      );

      expect(result.data[0].quantityAvailable).toBe(80);
      expect(result.data[0].isBelowRop).toBe(false);
    });

    it('computes isBelowRop = true when available < minStockLevel', async () => {
      const balance = makeBalance(10, 5, 20); // available=5, minStockLevel=20
      prisma.inventoryBalance.findMany.mockResolvedValue([balance]);
      prisma.inventoryBalance.count.mockResolvedValue(1);

      const result = await service.findBalances(
        tenantId,
        { page: 1, limit: 20 },
        ['admin'],
      );
      expect(result.data[0].isBelowRop).toBe(true);
    });

    it('when belowRop=true, total reflects only below-ROP items', async () => {
      const aboveRop = makeBalance(100, 0, 20); // available=100, above
      const belowRop = makeBalance(5, 0, 20); // available=5, below

      prisma.inventoryBalance.findMany.mockResolvedValue([aboveRop, belowRop]);

      const result = await service.findBalances(
        tenantId,
        { page: 1, limit: 20, belowRop: true },
        ['admin'],
      );

      expect(result.data).toHaveLength(1);
      expect(result.meta.totalItems).toBe(1);
    });

    it('excludes zero-stock by default', async () => {
      const query = { page: 1, limit: 20 } as any;
      prisma.inventoryBalance.findMany.mockResolvedValue([]);
      prisma.inventoryBalance.count.mockResolvedValue(0);

      await service.findBalances(tenantId, query, ['viewer']);

      expect(prisma.inventoryBalance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ quantityOnHand: { gt: 0 } }),
        }),
      );
    });
  });

  // ── findMovements ─────────────────────────────────────────────

  describe('findMovements', () => {
    it('returns paginated movement history', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([{ id: 'mv-1' }]);
      prisma.stockMovement.count.mockResolvedValue(1);

      const result = await service.findMovements(
        tenantId,
        { page: 1, limit: 20 },
        ['admin'],
      );
      expect(result.data).toHaveLength(1);
    });
  });

  // ── createAdjustment ─────────────────────────────────────────

  describe('createAdjustment', () => {
    const makeTx = (overrides?: any) => ({
      warehouse: {
        findFirst: jest.fn().mockResolvedValue({ id: warehouseId }),
      },
      item: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: itemId, isBatchTracked: false }),
      },
      inventoryBalance: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
      },
      stockMovement: { create: jest.fn(), createMany: jest.fn() },
      ...overrides,
    });

    it('creates new balance and movement for a positive adjustment', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        warehouseId,
        reasonCode: 'initial_stock',
        lines: [{ itemId, adjustmentQty: 50, uom: 'PCS' }],
      };

      const result = await service.createAdjustment(tenantId, userId, dto);

      expect(tx.inventoryBalance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantityOnHand: 50 }),
        }),
      );
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ direction: 'IN', quantity: 50 }),
        }),
      );
      expect(result.linesProcessed).toBe(1);
    });

    it('throws 400 INV_STOCK_NEGATIVE when adjustment would go below zero', async () => {
      const tx = makeTx();
      tx.inventoryBalance.findFirst.mockResolvedValue({
        id: 'bal-1',
        quantityOnHand: 10,
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        warehouseId,
        reasonCode: 'count_variance',
        lines: [{ itemId, adjustmentQty: -20, uom: 'PCS' }],
      };

      await expect(
        service.createAdjustment(tenantId, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 INV_LOT_REQUIRED for batch-tracked item without lotId', async () => {
      const tx = makeTx();
      tx.item.findFirst.mockResolvedValue({ id: itemId, isBatchTracked: true });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        warehouseId,
        reasonCode: 'initial_stock',
        lines: [{ itemId, adjustmentQty: 10, uom: 'PCS' }], // no lotId
      };

      await expect(
        service.createAdjustment(tenantId, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when warehouse not in tenant', async () => {
      const tx = makeTx();
      tx.warehouse.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.createAdjustment(tenantId, userId, {
          warehouseId,
          reasonCode: 'other',
          lines: [],
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── createTransfer ────────────────────────────────────────────

  describe('createTransfer', () => {
    const fromWh = 'from-wh-uuid';
    const toWh = 'to-wh-uuid';

    const makeTx = (srcQoh = 100, srcRes = 0) => ({
      warehouse: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: fromWh })
          .mockResolvedValueOnce({ id: toWh }),
      },
      inventoryBalance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'src-bal',
            quantityOnHand: srcQoh,
            quantityReserved: srcRes,
            variantId: null,
            costPerUnit: 50,
          })
          .mockResolvedValueOnce(null),
        update: jest.fn(),
        create: jest.fn(),
      },
      stockMovement: { createMany: jest.fn() },
    });

    it('transfers stock and creates 2 movements per line', async () => {
      const tx = makeTx(100, 0);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        lines: [{ itemId, quantity: 30, uom: 'PCS' }],
      };

      const result = await service.createTransfer(tenantId, userId, dto);

      expect(tx.inventoryBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantityOnHand: { decrement: 30 } }),
        }),
      );
      expect(tx.inventoryBalance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quantityOnHand: 30,
            variantId: null,
          }),
        }),
      );
      expect(tx.stockMovement.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              movementType: 'transfer_out',
              direction: 'OUT',
            }),
            expect.objectContaining({
              movementType: 'transfer_in',
              direction: 'IN',
            }),
          ]),
        }),
      );
      expect(result.linesTransferred).toBe(1);
    });

    it('throws 400 WMS_TRANSFER_SAME_WAREHOUSE', async () => {
      await expect(
        service.createTransfer(tenantId, userId, {
          fromWarehouseId: fromWh,
          toWarehouseId: fromWh,
          lines: [],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 INV_STOCK_INSUFFICIENT when available < requested', async () => {
      const tx = makeTx(10, 0); // available = 10
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        lines: [{ itemId, quantity: 50, uom: 'PCS' }], // requesting 50 > 10
      };

      await expect(
        service.createTransfer(tenantId, userId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('decrements quantityReserved on source proportionally', async () => {
      const tx = makeTx(100, 30); // 30 reserved
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        lines: [{ itemId, quantity: 20, uom: 'PCS' }],
      };

      await service.createTransfer(tenantId, userId, dto);

      expect(tx.inventoryBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quantityReserved: { decrement: 20 }, // min(20, 30) = 20
          }),
        }),
      );
    });

    it('propagates variantId from source to new destination balance', async () => {
      const variantId = 'variant-uuid';
      const tx = makeTx(100, 0);
      tx.inventoryBalance.findFirst
        .mockReset()
        .mockResolvedValueOnce({
          id: 'src-bal',
          quantityOnHand: 100,
          quantityReserved: 0,
          variantId,
          costPerUnit: 50,
        })
        .mockResolvedValueOnce(null);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        fromWarehouseId: fromWh,
        toWarehouseId: toWh,
        lines: [{ itemId, quantity: 10, uom: 'PCS' }],
      };

      await service.createTransfer(tenantId, userId, dto);

      expect(tx.inventoryBalance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ variantId }),
        }),
      );
    });
  });
});
