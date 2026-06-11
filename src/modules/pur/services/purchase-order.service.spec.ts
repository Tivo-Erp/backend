import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PurchaseOrderService } from './purchase-order.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({
  purchaseOrder: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  goodsReceipt: { count: jest.fn() },
  $transaction: jest.fn(),
});

const makeTx = () => ({
  supplier: {
    findFirst: jest.fn().mockResolvedValue({
      id: 's1',
      isActive: true,
      paymentTermsDays: 30,
    }),
  },
  warehouse: {
    findFirst: jest.fn().mockResolvedValue({ id: 'w1', isActive: true }),
  },
  branch: {
    findFirst: jest.fn().mockResolvedValue({ id: 'b1' }),
  },
  item: {
    findFirst: jest.fn().mockResolvedValue({ id: 'i1', isPurchasable: true }),
  },
  purchaseOrder: {
    findFirst: jest.fn(),
    create: jest
      .fn()
      .mockImplementation((args: any) =>
        Promise.resolve({ id: 'po1', ...args.data }),
      ),
    update: jest
      .fn()
      .mockImplementation((args: any) =>
        Promise.resolve({ id: 'po1', ...args.data }),
      ),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  purchaseOrderLine: {
    deleteMany: jest.fn(),
  },
  goodsReceipt: { count: jest.fn().mockResolvedValue(0) },
});

describe('PurchaseOrderService', () => {
  let service: PurchaseOrderService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('PO-2026-00001'),
  };

  const tenantId = 'tenant-uuid';
  const userId = 'user-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrderService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();

    service = module.get(PurchaseOrderService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('PO-2026-00001');
  });

  describe('create', () => {
    it('computes line totals, tax, discount and grand total as exact 2dp decimals', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        supplierId: 's1',
        warehouseId: 'w1',
        lines: [
          {
            itemId: 'i1',
            quantity: 10,
            uom: 'PCS',
            unitPrice: 1000,
            discountPct: 10,
            taxRate: 10,
          },
        ],
      };

      await service.create(tenantId, userId, dto);

      // lineTotal = 10 * 1000 * 0.9 = 9000 ; discount = 1000 ; tax = 900 ; grand = 9900
      const data = tx.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.subTotal).toBeInstanceOf(Prisma.Decimal);
      expect(data.subTotal.toFixed(2)).toBe('9000.00');
      expect(data.discountAmount.toFixed(2)).toBe('1000.00');
      expect(data.taxAmount.toFixed(2)).toBe('900.00');
      expect(data.grandTotal.toFixed(2)).toBe('9900.00');
      expect(data.status).toBe('draft');
      expect(data.poNumber).toBe('PO-2026-00001');
      expect(data.lines.create[0].lineTotal.toFixed(2)).toBe('9000.00');
    });

    it('avoids float drift (0.1 + 0.2 style) in totals', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const dto: any = {
        supplierId: 's1',
        warehouseId: 'w1',
        lines: [
          // 3 * 0.1 = 0.30000000000000004 with JS floats
          { itemId: 'i1', quantity: 3, uom: 'PCS', unitPrice: 0.1 },
          { itemId: 'i1', quantity: 1, uom: 'PCS', unitPrice: 0.2 },
        ],
      };

      await service.create(tenantId, userId, dto);

      const data = tx.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.subTotal.toFixed(2)).toBe('0.50');
      expect(data.grandTotal.toFixed(2)).toBe('0.50');
    });

    it('throws 404 when supplier inactive', async () => {
      const tx = makeTx();
      tx.supplier.findFirst.mockResolvedValue({ id: 's1', isActive: false });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          supplierId: 's1',
          warehouseId: 'w1',
          lines: [{ itemId: 'i1', quantity: 1, uom: 'PCS', unitPrice: 1 }],
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 ORG_BRANCH_NOT_FOUND when branchId does not belong to tenant', async () => {
      const tx = makeTx();
      tx.branch.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          supplierId: 's1',
          warehouseId: 'w1',
          branchId: 'branch-x',
          lines: [{ itemId: 'i1', quantity: 1, uom: 'PCS', unitPrice: 1 }],
        } as any),
      ).rejects.toThrow(/ORG_BRANCH_NOT_FOUND/);
      expect(tx.branch.findFirst).toHaveBeenCalledWith({
        where: { id: 'branch-x', tenantId },
        select: { id: true },
      });
    });

    it('throws 400 when item not purchasable', async () => {
      const tx = makeTx();
      tx.item.findFirst.mockResolvedValue({ id: 'i1', isPurchasable: false });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          supplierId: 's1',
          warehouseId: 'w1',
          lines: [{ itemId: 'i1', quantity: 1, uom: 'PCS', unitPrice: 1 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates header fields when PO is draft', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'draft',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.update(tenantId, 'po1', userId, {
        notes: 'updated',
        paymentTermsDays: 45,
      });

      expect(tx.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po1' },
          data: expect.objectContaining({
            notes: 'updated',
            paymentTermsDays: 45,
            updatedBy: userId,
          }),
        }),
      );
      expect(tx.purchaseOrderLine.deleteMany).not.toHaveBeenCalled();
    });

    it('replaces lines and recomputes totals server-side', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'draft',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.update(tenantId, 'po1', userId, {
        lines: [
          {
            itemId: 'i1',
            quantity: 2,
            uom: 'PCS',
            unitPrice: 100,
            taxRate: 10,
          },
        ],
      });

      expect(tx.purchaseOrderLine.deleteMany).toHaveBeenCalledWith({
        where: { poId: 'po1' },
      });
      const data = tx.purchaseOrder.update.mock.calls[0][0].data;
      expect(data.subTotal.toFixed(2)).toBe('200.00');
      expect(data.taxAmount.toFixed(2)).toBe('20.00');
      expect(data.grandTotal.toFixed(2)).toBe('220.00');
      expect(data.lines.create).toHaveLength(1);
    });

    it('throws 409 PUR_PO_NOT_DRAFT when PO is not draft', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'approved',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.update(tenantId, 'po1', userId, { notes: 'x' } as any),
      ).rejects.toThrow(ConflictException);
      expect(tx.purchaseOrder.update).not.toHaveBeenCalled();
    });

    it('throws 404 when PO not found or soft-deleted', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.update(tenantId, 'po1', userId, { notes: 'x' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    it('soft deletes a draft PO with a guarded updateMany', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'draft',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.remove(tenantId, 'po1');

      expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: { id: 'po1', tenantId, status: 'draft', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('throws 409 PUR_PO_NOT_DRAFT when guarded delete matches nothing', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'approved',
      });
      tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.remove(tenantId, 'po1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws 404 when PO not found', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.remove(tenantId, 'po1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('state machine', () => {
    it('submit: draft → pending_approval', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'draft',
      });
      await service.submit(tenantId, 'po1');
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po1' },
        data: { status: 'pending_approval' },
      });
    });

    it('submit: throws 409 when not draft', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'approved',
      });
      await expect(service.submit(tenantId, 'po1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('approve: pending_approval → approved sets approvedBy', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'pending_approval',
      });
      await service.approve(tenantId, 'po1', userId);
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'approved',
            approvedBy: userId,
          }),
        }),
      );
    });

    it('cancel: throws 409 when GRN exists', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'approved',
      });
      tx.goodsReceipt.count.mockResolvedValue(1);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.cancel(tenantId, 'po1')).rejects.toThrow(
        ConflictException,
      );
      expect(tx.purchaseOrder.updateMany).not.toHaveBeenCalled();
    });

    it('cancel: succeeds via guarded updateMany when no GRN', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst
        .mockResolvedValueOnce({ id: 'po1', status: 'approved' })
        .mockResolvedValueOnce({ id: 'po1', status: 'cancelled' });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const result = await service.cancel(tenantId, 'po1');

      expect(tx.purchaseOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'po1',
          tenantId,
          status: { in: expect.arrayContaining(['draft', 'approved']) },
          deletedAt: null,
        },
        data: { status: 'cancelled' },
      });
      expect(result).toEqual({ id: 'po1', status: 'cancelled' });
    });

    it('cancel: throws 409 when status changed concurrently (guarded update count 0)', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'approved',
      });
      tx.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.cancel(tenantId, 'po1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('cancel: throws 409 when already fully received', async () => {
      const tx = makeTx();
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po1',
        status: 'fully_received',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.cancel(tenantId, 'po1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
