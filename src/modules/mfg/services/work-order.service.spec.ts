import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { WorkOrderService } from './work-order.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({
  workOrder: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  bOM: { findFirst: jest.fn() },
  $transaction: jest.fn(),
});

describe('WorkOrderService', () => {
  let service: WorkOrderService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = { getNextNumber: jest.fn().mockResolvedValue('WO-2026-00001') };
  const tenantId = 't1';
  const userId = 'u1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrderService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();
    service = module.get(WorkOrderService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('WO-2026-00001');
  });

  describe('create', () => {
    const dto: any = {
      itemId: 'i1',
      bomId: 'b1',
      warehouseId: 'w1',
      plannedQty: 100,
      uom: 'PCS',
      plannedStartDate: '2026-07-01',
      plannedEndDate: '2026-07-10',
    };

    it('rejects when planned end precedes start', async () => {
      await expect(
        service.create(tenantId, userId, {
          ...dto,
          plannedStartDate: '2026-07-10',
          plannedEndDate: '2026-07-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a BOM that belongs to a different item', async () => {
      const tx = {
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1' }) },
        bOM: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', itemId: 'OTHER', isActive: true }) },
        warehouse: { findFirst: jest.fn() },
        workOrder: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(service.create(tenantId, userId, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates a draft WO with server-assigned number', async () => {
      const tx = {
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1' }) },
        bOM: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', itemId: 'i1', isActive: true }) },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }) },
        workOrder: {
          create: jest.fn().mockImplementation((a: any) => ({ id: 'wo1', ...a.data })),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const wo: any = await service.create(tenantId, userId, dto);
      expect(wo.woNumber).toBe('WO-2026-00001');
      expect(wo.status).toBe('draft');
    });
  });

  describe('reportConsumption', () => {
    it('rejects when WO is not in an executable state', async () => {
      const tx = {
        workOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'wo1', status: 'draft', warehouseId: 'w1' }) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportConsumption(tenantId, userId, 'wo1', {
          lines: [{ itemId: 'i2', quantity: 5, uom: 'KG' }],
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when stock is insufficient', async () => {
      const tx = {
        workOrder: {
          findFirst: jest.fn().mockResolvedValue({ id: 'wo1', status: 'released', warehouseId: 'w1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i2' }) },
        inventoryBalance: {
          findFirst: jest.fn().mockResolvedValue({ id: 'bal1', quantityOnHand: '3', quantityReserved: '0', costPerUnit: '10', uom: 'KG' }),
          updateMany: jest.fn(),
        },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportConsumption(tenantId, userId, 'wo1', {
          lines: [{ itemId: 'i2', quantity: 5 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the WO claim loses to a concurrent cancel', async () => {
      const tx = {
        workOrder: {
          findFirst: jest.fn().mockResolvedValue({ id: 'wo1', status: 'released', warehouseId: 'w1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportConsumption(tenantId, userId, 'wo1', {
          lines: [{ itemId: 'i2', quantity: 5 }],
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the guarded balance decrement loses a concurrent race', async () => {
      const tx = {
        workOrder: {
          findFirst: jest.fn().mockResolvedValue({ id: 'wo1', status: 'in_progress', warehouseId: 'w1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i2' }) },
        inventoryBalance: {
          findFirst: jest.fn().mockResolvedValue({ id: 'bal1', quantityOnHand: '100', quantityReserved: '0', costPerUnit: '10', uom: 'KG' }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportConsumption(tenantId, userId, 'wo1', {
          lines: [{ itemId: 'i2', quantity: 5 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('rejects a bin outside the WO warehouse', async () => {
      const tx = {
        workOrder: {
          findFirst: jest.fn().mockResolvedValue({ id: 'wo1', status: 'in_progress', warehouseId: 'w1' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i2' }) },
        bin: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportConsumption(tenantId, userId, 'wo1', {
          lines: [{ itemId: 'i2', quantity: 5, binId: 'foreign-bin' }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.bin.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'foreign-bin', zone: { warehouseId: 'w1' } },
        }),
      );
    });

    it('consumes stock (guarded decrement, server-side uom) and flips released → in_progress', async () => {
      const tx = {
        workOrder: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 'wo1', status: 'released', warehouseId: 'w1' })
            .mockResolvedValueOnce({ id: 'wo1', status: 'in_progress' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i2' }) },
        inventoryBalance: {
          findFirst: jest.fn().mockResolvedValue({ id: 'bal1', quantityOnHand: '100', quantityReserved: '0', costPerUnit: '10', uom: 'KG' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await service.reportConsumption(tenantId, userId, 'wo1', {
        lines: [{ itemId: 'i2', quantity: 5 }],
      } as any);
      expect(tx.inventoryBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'bal1',
            quantityOnHand: { gte: expect.any(Prisma.Decimal) },
          }),
          data: { quantityOnHand: { decrement: expect.any(Prisma.Decimal) } },
        }),
      );
      expect(tx.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'in_progress' }) }),
      );
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ uom: 'KG', direction: 'OUT' }) }),
      );
    });
  });

  describe('reportOutput', () => {
    const baseWo = {
      id: 'wo1',
      status: 'in_progress',
      itemId: 'i1',
      warehouseId: 'w1',
      uom: 'PCS',
      plannedQty: '100',
      producedQty: '0',
      rejectedQty: '0',
    };

    it('rejects output that would exceed planned qty', async () => {
      const tx = {
        workOrder: { findFirst: jest.fn().mockResolvedValue({ ...baseWo, producedQty: '98' }) },
        inventoryBalance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportOutput(tenantId, userId, 'wo1', { producedQty: 5 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the optimistic qty claim loses a concurrent race', async () => {
      const tx = {
        workOrder: {
          findFirst: jest.fn().mockResolvedValue({ ...baseWo }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1', isBatchTracked: false }) },
        inventoryBalance: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportOutput(tenantId, userId, 'wo1', { producedQty: 10 } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            producedQty: baseWo.producedQty,
            rejectedQty: baseWo.rejectedQty,
          }),
        }),
      );
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.inventoryBalance.create).not.toHaveBeenCalled();
    });

    it('requires a lot for batch-tracked finished goods', async () => {
      const tx = {
        workOrder: { findFirst: jest.fn().mockResolvedValue({ ...baseWo }) },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1', isBatchTracked: true }) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.reportOutput(tenantId, userId, 'wo1', { producedQty: 10 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks WO completed when produced reaches planned', async () => {
      const tx = {
        workOrder: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ ...baseWo, producedQty: '90' })
            .mockResolvedValueOnce({ id: 'wo1', status: 'completed' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1', isBatchTracked: false }) },
        inventoryBalance: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
        stockMovement: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await service.reportOutput(tenantId, userId, 'wo1', { producedQty: 10 } as any);
      expect(tx.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
      );
      expect(tx.inventoryBalance.create).toHaveBeenCalled();
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ direction: 'IN' }) }),
      );
    });
  });

  describe('remove', () => {
    it('soft deletes a draft WO', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({ id: 'wo1', status: 'draft' });
      prisma.workOrder.updateMany.mockResolvedValue({ count: 1 });
      await service.remove(tenantId, 'wo1');
      expect(prisma.workOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'draft', deletedAt: null }),
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('transitions', () => {
    it('release requires planned status (guarded updateMany)', async () => {
      prisma.workOrder.findFirst.mockResolvedValue({ id: 'wo1', status: 'draft' });
      prisma.workOrder.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.release(tenantId, 'wo1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('cancel rejects an unknown WO', async () => {
      prisma.workOrder.findFirst.mockResolvedValue(null);
      await expect(service.cancel(tenantId, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
