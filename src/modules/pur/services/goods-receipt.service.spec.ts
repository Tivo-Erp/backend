import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { GoodsReceiptService } from './goods-receipt.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({ $transaction: jest.fn() });

describe('GoodsReceiptService', () => {
  let service: GoodsReceiptService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('GRN-2026-00001'),
  };

  const tenantId = 'tenant-uuid';
  const userId = 'user-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoodsReceiptService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();

    service = module.get(GoodsReceiptService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('GRN-2026-00001');
  });

  const makeTx = (overrides: any = {}) => ({
    purchaseOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'po1',
        status: 'approved',
        lines: [
          {
            id: 'pl1',
            itemId: 'i1',
            quantity: 100,
            receivedQty: 0,
            uom: 'PCS',
            unitPrice: 50,
            variantId: null,
          },
        ],
      }),
      update: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'w1' }),
    },
    bin: {
      findFirst: jest.fn().mockResolvedValue({ id: 'b1' }),
    },
    item: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'i1', isBatchTracked: false }),
    },
    lot: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'lot1' }),
    },
    inventoryBalance: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    },
    stockMovement: { create: jest.fn() },
    purchaseOrderLine: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'pl1', quantity: 100, receivedQty: 100 }]),
    },
    goodsReceipt: {
      create: jest.fn().mockResolvedValue({ id: 'grn1', lines: [] }),
    },
    ...overrides,
  });

  const baseDto = (lines: any[]): any => ({
    poId: 'po1',
    warehouseId: 'w1',
    lines,
  });

  it('creates stock movement, balance and increments PO received qty via guarded update', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(
      tenantId,
      userId,
      baseDto([{ poLineId: 'pl1', receivedQty: 100 }]),
    );

    expect(tx.inventoryBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          quantityOnHand: new Prisma.Decimal(100),
        }),
      }),
    );
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: 'grn_receipt',
          direction: 'IN',
          quantity: new Prisma.Decimal(100),
        }),
      }),
    );
    expect(tx.purchaseOrderLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pl1',
        poId: 'po1',
        receivedQty: { lte: new Prisma.Decimal(0) },
      },
      data: { receivedQty: { increment: new Prisma.Decimal(100) } },
    });
  });

  it('sets PO status fully_received when all lines received', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(
      tenantId,
      userId,
      baseDto([{ poLineId: 'pl1', receivedQty: 100 }]),
    );

    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { status: 'fully_received' },
    });
  });

  it('sets PO status partial_received when lines remain', async () => {
    const tx = makeTx();
    tx.purchaseOrderLine.findMany.mockResolvedValue([
      { id: 'pl1', quantity: 100, receivedQty: 40 },
    ]);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(
      tenantId,
      userId,
      baseDto([{ poLineId: 'pl1', receivedQty: 40 }]),
    );

    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { status: 'partial_received' },
    });
  });

  it('compares fractional received quantities as decimals when recomputing status', async () => {
    const tx = makeTx();
    tx.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po1',
      status: 'approved',
      lines: [
        {
          id: 'pl1',
          itemId: 'i1',
          quantity: '0.3',
          receivedQty: '0',
          uom: 'PCS',
          unitPrice: 50,
          variantId: null,
        },
      ],
    });
    tx.purchaseOrderLine.findMany.mockResolvedValue([
      { id: 'pl1', quantity: '0.3', receivedQty: '0.3' },
    ]);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(
      tenantId,
      userId,
      baseDto([{ poLineId: 'pl1', receivedQty: 0.3 }]),
    );

    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po1' },
      data: { status: 'fully_received' },
    });
  });

  it('throws 400 when received exceeds remaining PO qty (in-memory fast fail)', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 200 }]),
      ),
    ).rejects.toThrow(/PUR_GRN_EXCEEDS_PO_QTY/);
  });

  it('throws 400 when guarded conditional update affects 0 rows (concurrent over-receipt)', async () => {
    const tx = makeTx();
    // In-memory check passes (50 <= 100 remaining) but a concurrent
    // transaction already consumed the quantity → updateMany matches nothing.
    tx.purchaseOrderLine.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 50 }]),
      ),
    ).rejects.toThrow(/PUR_GRN_EXCEEDS_PO_QTY/);
    expect(tx.goodsReceipt.create).not.toHaveBeenCalled();
  });

  it('throws 400 PUR_GRN_DUPLICATE_PO_LINE when two lines reference the same PO line', async () => {
    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([
          { poLineId: 'pl1', receivedQty: 10 },
          { poLineId: 'pl1', receivedQty: 20 },
        ]),
      ),
    ).rejects.toThrow(/PUR_GRN_DUPLICATE_PO_LINE/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws 404 WMS_WAREHOUSE_NOT_FOUND when warehouse missing/inactive/other tenant', async () => {
    const tx = makeTx();
    tx.warehouse.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 10 }]),
      ),
    ).rejects.toThrow(NotFoundException);
    expect(tx.warehouse.findFirst).toHaveBeenCalledWith({
      where: { id: 'w1', tenantId, isActive: true },
      select: { id: true },
    });
  });

  it('throws 400 WMS_BIN_NOT_IN_WAREHOUSE when bin not in GRN warehouse', async () => {
    const tx = makeTx();
    tx.bin.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 10, binId: 'bin-x' }]),
      ),
    ).rejects.toThrow(/WMS_BIN_NOT_IN_WAREHOUSE/);
    expect(tx.bin.findFirst).toHaveBeenCalledWith({
      where: { id: 'bin-x', zone: { warehouseId: 'w1' } },
      select: { id: true },
    });
  });

  it('throws 400 INV_LOT_REQUIRED for batch-tracked item without lotNumber', async () => {
    const tx = makeTx();
    tx.item.findFirst.mockResolvedValue({ id: 'i1', isBatchTracked: true });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 10 }]),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 409 INV_LOT_ITEM_MISMATCH when lot number belongs to a different item', async () => {
    const tx = makeTx();
    tx.item.findFirst.mockResolvedValue({ id: 'i1', isBatchTracked: true });
    tx.lot.findUnique.mockResolvedValue({
      id: 'lot9',
      itemId: 'other-item',
      status: 'active',
    });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 10, lotNumber: 'LOT-A' }]),
      ),
    ).rejects.toThrow(/INV_LOT_ITEM_MISMATCH/);
    expect(tx.lot.create).not.toHaveBeenCalled();
  });

  it('throws 409 INV_LOT_INACTIVE when reusing a non-active lot', async () => {
    const tx = makeTx();
    tx.item.findFirst.mockResolvedValue({ id: 'i1', isBatchTracked: true });
    tx.lot.findUnique.mockResolvedValue({
      id: 'lot9',
      itemId: 'i1',
      status: 'quarantined',
    });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 10, lotNumber: 'LOT-A' }]),
      ),
    ).rejects.toThrow(/INV_LOT_INACTIVE/);
  });

  it('reuses an existing active lot of the same item and updates expiry when provided', async () => {
    const tx = makeTx();
    tx.item.findFirst.mockResolvedValue({ id: 'i1', isBatchTracked: true });
    tx.lot.findUnique.mockResolvedValue({
      id: 'lot9',
      itemId: 'i1',
      status: 'active',
    });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(
      tenantId,
      userId,
      baseDto([
        {
          poLineId: 'pl1',
          receivedQty: 10,
          lotNumber: 'LOT-A',
          expiryDate: '2027-01-01',
        },
      ]),
    );

    expect(tx.lot.create).not.toHaveBeenCalled();
    expect(tx.lot.update).toHaveBeenCalledWith({
      where: { id: 'lot9' },
      data: { expiryDate: new Date('2027-01-01') },
    });
    expect(tx.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lotId: 'lot9' }),
      }),
    );
  });

  it('creates a new lot for batch-tracked items when none exists', async () => {
    const tx = makeTx();
    tx.item.findFirst.mockResolvedValue({ id: 'i1', isBatchTracked: true });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(
      tenantId,
      userId,
      baseDto([{ poLineId: 'pl1', receivedQty: 10, lotNumber: 'LOT-NEW' }]),
    );

    expect(tx.lot.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        lotNumber: 'LOT-NEW',
        itemId: 'i1',
        expiryDate: null,
      },
    });
  });

  it('throws 409 when PO not in a receivable status', async () => {
    const tx = makeTx();
    tx.purchaseOrder.findFirst.mockResolvedValue({
      id: 'po1',
      status: 'draft',
      lines: [],
    });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(
        tenantId,
        userId,
        baseDto([{ poLineId: 'pl1', receivedQty: 10 }]),
      ),
    ).rejects.toThrow(ConflictException);
  });
});
