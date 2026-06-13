import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { DeliveryNoteService } from './delivery-note.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({
  deliveryNote: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
});

describe('DeliveryNoteService', () => {
  let service: DeliveryNoteService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = { getNextNumber: jest.fn().mockResolvedValue('DN-2026-00001') };
  const tenantId = 't1';
  const userId = 'u1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryNoteService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();
    service = module.get(DeliveryNoteService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('DN-2026-00001');
  });

  describe('create', () => {
    it('rejects when the SO is not in an approved/processing state', async () => {
      const tx = {
        salesOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'so1', status: 'draft', lines: [] }) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, userId, { soId: 'so1', warehouseId: 'w1', lines: [] } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a ship qty exceeding the remaining SO line qty', async () => {
      const tx = {
        salesOrder: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'so1', status: 'approved', customerId: 'c1',
            lines: [{ id: 'sol1', itemId: 'i1', quantity: '10', shippedQty: '8', uom: 'PCS' }],
          }),
          updateMany: jest.fn(),
        },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }) },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1', sku: 'SKU1', isBatchTracked: false, isSerialTracked: false }) },
        deliveryNoteLine: { findMany: jest.fn().mockResolvedValue([]) },
        deliveryNote: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, userId, {
          soId: 'so1', warehouseId: 'w1',
          lines: [{ soLineId: 'sol1', quantity: 5 }], // remaining is 2
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a lot for batch-tracked items', async () => {
      const tx = {
        salesOrder: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'so1', status: 'approved', customerId: 'c1',
            lines: [{ id: 'sol1', itemId: 'i1', quantity: '10', shippedQty: '0', uom: 'PCS' }],
          }),
        },
        warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }) },
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1', sku: 'SKU1', isBatchTracked: true, isSerialTracked: false }) },
        deliveryNoteLine: { findMany: jest.fn().mockResolvedValue([]) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, userId, {
          soId: 'so1', warehouseId: 'w1', lines: [{ soLineId: 'sol1', quantity: 1 }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('submitPod (delivery completion §1.5)', () => {
    const dn = {
      id: 'dn1', status: 'out_for_delivery', warehouseId: 'w1', soId: 'so1',
      lines: [{ id: 'dl1', soLineId: 'sol1', itemId: 'i1', quantity: '5', uom: 'PCS', binId: null, lotId: null, actualBinId: null, actualLotId: null }],
    };

    it('deducts stock OUT, advances SO shipped qty, recomputes SO status', async () => {
      const tx = {
        deliveryNote: {
          findFirst: jest.fn()
            .mockResolvedValueOnce(dn)
            .mockResolvedValueOnce({ id: 'dn1', status: 'delivered' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        inventoryBalance: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'b1', quantityOnHand: '100', quantityReserved: '5', costPerUnit: '12' },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        stockMovement: { create: jest.fn() },
        salesOrderLine: {
          update: jest.fn(),
          findMany: jest.fn().mockResolvedValue([{ quantity: '5', shippedQty: '5' }]),
        },
        salesOrder: { updateMany: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.submitPod(tenantId, userId, 'dn1', { podType: 'signature', signatureDataUrl: 'data:img' } as any);

      expect(tx.inventoryBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quantityOnHand: { decrement: expect.any(Prisma.Decimal) },
            quantityReserved: { decrement: expect.any(Prisma.Decimal) },
          }),
        }),
      );
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ movementType: 'sales_shipment', direction: 'OUT' }) }),
      );
      expect(tx.salesOrderLine.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { shippedQty: { increment: expect.any(Prisma.Decimal) } } }),
      );
      expect(tx.salesOrder.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'fulfilled' } }),
      );
    });

    it('requires POD evidence', async () => {
      await expect(
        service.submitPod(tenantId, userId, 'dn1', { podType: 'signature' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects POD when DN is not out for delivery', async () => {
      const tx = {
        deliveryNote: { findFirst: jest.fn().mockResolvedValue({ id: 'dn1', status: 'packed', lines: [] }) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.submitPod(tenantId, userId, 'dn1', { podType: 'signature', signatureDataUrl: 'x' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('redispatch', () => {
    it('refuses when max retries exceeded', async () => {
      prisma.deliveryNote.findFirst.mockResolvedValue({ id: 'dn1', status: 'failed', retryCount: 3 });
      await expect(service.redispatch(tenantId, 'dn1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s on an unknown DN', async () => {
      prisma.deliveryNote.findFirst.mockResolvedValue(null);
      await expect(service.redispatch(tenantId, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
