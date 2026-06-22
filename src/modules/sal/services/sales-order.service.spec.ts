import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SalesOrderService } from './sales-order.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { OutboxService } from '../../../infra/events/outbox.service.js';

const makePrisma = () => ({
  $transaction: jest.fn(),
  salesOrder: { findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn() },
});

describe('SalesOrderService', () => {
  let service: SalesOrderService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('SO-2026-00001'),
  };

  const tenantId = 'tenant-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrderService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
        { provide: OutboxService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(SalesOrderService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  // ── confirm ─────────────────────────────────────────────────────

  interface ConfirmTxOpts {
    creditLimit?: number;
    creditUsed?: number;
    available?: number;
    reserved?: number;
    claimCount?: number;
    creditApplyCount?: number;
    reserveCount?: number;
    soStatus?: string;
  }

  const makeConfirmTx = ({
    creditLimit = 100000,
    creditUsed = 0,
    available = 1000,
    reserved = 0,
    claimCount = 1,
    creditApplyCount = 1,
    reserveCount = 1,
    soStatus = 'draft',
  }: ConfirmTxOpts = {}) => ({
    salesOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'so1',
        status: soStatus,
        customerId: 'c1',
        warehouseId: 'w1',
        grandTotal: 5000,
        lines: [{ itemId: 'i1', quantity: 10, shippedQty: 0 }],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
      update: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: 'so1', ...args.data }),
        ),
    },
    customer: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'c1', creditLimit, creditUsed }),
      updateMany: jest.fn().mockResolvedValue({ count: creditApplyCount }),
    },
    inventoryBalance: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'b1', quantityOnHand: available, quantityReserved: reserved },
        ]),
      updateMany: jest.fn().mockResolvedValue({ count: reserveCount }),
    },
  });

  it('confirm within credit limit → claim flips draft → approved, credit applied conditionally', async () => {
    const tx = makeConfirmTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.confirm(tenantId, 'so1');

    // Claim is a guarded conditional update on draft status
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'so1', tenantId, status: 'draft', deletedAt: null },
      data: { status: 'approved' },
    });

    // Credit applied via conditional update with the limit guard
    const creditCall = tx.customer.updateMany.mock.calls[0][0];
    expect(creditCall.where.id).toBe('c1');
    expect(creditCall.where.tenantId).toBe(tenantId);
    expect(Number(creditCall.where.creditUsed.lte)).toBe(95000); // 100000 - 5000
    expect(Number(creditCall.data.creditUsed.increment)).toBe(5000);

    // No downgrade to pending_approval
    expect(tx.salesOrder.update).not.toHaveBeenCalled();
  });

  it('confirm: credit conditional update count 0 → pending_approval, no credit applied', async () => {
    const tx = makeConfirmTx({ creditLimit: 4000, creditApplyCount: 0 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.confirm(tenantId, 'so1');

    const creditCall = tx.customer.updateMany.mock.calls[0][0];
    expect(Number(creditCall.where.creditUsed.lte)).toBe(-1000); // 4000 - 5000
    expect(tx.salesOrder.update).toHaveBeenCalledWith({
      where: { id: 'so1' },
      data: { status: 'pending_approval' },
    });
  });

  it('confirm: creditLimit = 0 means unlimited — plain increment, never pending_approval', async () => {
    const tx = makeConfirmTx({ creditLimit: 0, creditUsed: 999999999 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.confirm(tenantId, 'so1');

    const creditCall = tx.customer.updateMany.mock.calls[0][0];
    expect(creditCall.where).toEqual({ id: 'c1', tenantId }); // no limit guard
    expect(Number(creditCall.data.creditUsed.increment)).toBe(5000);
    expect(tx.salesOrder.update).not.toHaveBeenCalled(); // stays approved
  });

  it('confirm reserves stock with a guarded conditional increment', async () => {
    const tx = makeConfirmTx({ available: 1000 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.confirm(tenantId, 'so1');

    const reserveCall = tx.inventoryBalance.updateMany.mock.calls[0][0];
    expect(reserveCall.where.id).toBe('b1');
    // guard bound: quantityReserved <= onHand(1000) - take(10) = 990
    expect(Number(reserveCall.where.quantityReserved.lte)).toBe(990);
    expect(Number(reserveCall.data.quantityReserved.increment)).toBe(10);
  });

  it('confirm throws 400 INV_STOCK_INSUFFICIENT on the availability pre-check', async () => {
    const tx = makeConfirmTx({ available: 5 }); // 5 < qty 10
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.confirm(tenantId, 'so1')).rejects.toThrow(
      BadRequestException,
    );
    expect(tx.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  it('confirm: reservation guard count 0 (lost race) → INV_STOCK_INSUFFICIENT, rollback', async () => {
    const tx = makeConfirmTx({ available: 1000, reserveCount: 0 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.confirm(tenantId, 'so1')).rejects.toThrow(
      /INV_STOCK_INSUFFICIENT/,
    );
    // Throwing inside the transaction rolls back the claim — no credit applied
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('double confirm blocked: claim count 0 → 409 SAL_SO_NOT_DRAFT, no side effects', async () => {
    const tx = makeConfirmTx({ claimCount: 0, soStatus: 'approved' });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.confirm(tenantId, 'so1')).rejects.toThrow(
      ConflictException,
    );
    await expect(service.confirm(tenantId, 'so1')).rejects.toThrow(
      'SAL_SO_NOT_DRAFT',
    );
    expect(tx.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('confirm re-checks the customer is active → 404 when inactive/missing', async () => {
    const tx = makeConfirmTx();
    tx.customer.findFirst.mockResolvedValue(null); // isActive: true filter missed
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.confirm(tenantId, 'so1')).rejects.toThrow(
      NotFoundException,
    );
    expect(tx.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  // ── approve ─────────────────────────────────────────────────────

  const makeApproveTx = (claimCount = 1) => ({
    salesOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'so1',
        status: 'pending_approval',
        customerId: 'c1',
        grandTotal: 5000,
        lines: [],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
    },
    customer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  });

  it('approve: race-safe claim pending_approval → approved, applies credit', async () => {
    const tx = makeApproveTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.approve(tenantId, 'so1', 'user-uuid');

    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'so1',
        tenantId,
        status: 'pending_approval',
        deletedAt: null,
      },
      data: expect.objectContaining({
        status: 'approved',
        approvedBy: 'user-uuid',
      }),
    });
    const creditCall = tx.customer.updateMany.mock.calls[0][0];
    expect(creditCall.where).toEqual({ id: 'c1', tenantId });
    expect(Number(creditCall.data.creditUsed.increment)).toBe(5000);
  });

  it('approve: claim count 0 → 409 SAL_SO_NOT_PENDING, no credit applied', async () => {
    const tx = makeApproveTx(0);
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.approve(tenantId, 'so1', 'user-uuid')).rejects.toThrow(
      'SAL_SO_NOT_PENDING',
    );
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  // ── cancel ──────────────────────────────────────────────────────

  const makeCancelTx = (
    status: string,
    { shippedQty = 0, claimCount = 1, creditReleaseCount = 1 } = {},
  ) => ({
    salesOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'so1',
        status,
        customerId: 'c1',
        warehouseId: 'w1',
        grandTotal: 5000,
        lines: [{ itemId: 'i1', quantity: 10, shippedQty }],
      }),
      updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
    },
    customer: {
      updateMany: jest.fn().mockResolvedValue({ count: creditReleaseCount }),
    },
    inventoryBalance: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'b1', quantityOnHand: 100, quantityReserved: 50 },
        ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  });

  it('cancel of approved SO releases reservation and decrements credit', async () => {
    const tx = makeCancelTx('approved');
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.cancel(tenantId, 'so1');

    // Claim pinned to the previously-read status
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'so1', tenantId, status: 'approved', deletedAt: null },
      data: { status: 'cancelled' },
    });

    // Reservation release guarded so it never goes negative
    const releaseCall = tx.inventoryBalance.updateMany.mock.calls[0][0];
    expect(releaseCall.where.id).toBe('b1');
    expect(Number(releaseCall.where.quantityReserved.gte)).toBe(10);
    expect(Number(releaseCall.data.quantityReserved.decrement)).toBe(10);

    // Credit decrement guarded with creditUsed >= grandTotal
    const creditCall = tx.customer.updateMany.mock.calls[0][0];
    expect(Number(creditCall.where.creditUsed.gte)).toBe(5000);
    expect(Number(creditCall.data.creditUsed.decrement)).toBe(5000);
  });

  it('cancel of approved SO clamps creditUsed to 0 when the guarded decrement misses', async () => {
    const tx = makeCancelTx('approved', { creditReleaseCount: 0 });
    tx.customer.updateMany
      .mockResolvedValueOnce({ count: 0 }) // guarded decrement misses
      .mockResolvedValueOnce({ count: 1 }); // clamp
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.cancel(tenantId, 'so1');

    expect(tx.customer.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'c1', tenantId },
      data: { creditUsed: 0 },
    });
  });

  it('cancel of draft SO is a pure status flip — no stock or credit compensation', async () => {
    const tx = makeCancelTx('draft');
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.cancel(tenantId, 'so1');

    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'so1', tenantId, status: 'draft', deletedAt: null },
      data: { status: 'cancelled' },
    });
    expect(tx.inventoryBalance.findMany).not.toHaveBeenCalled();
    expect(tx.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('cancel of pending_approval SO releases reservation but not credit', async () => {
    const tx = makeCancelTx('pending_approval');
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.cancel(tenantId, 'so1');

    expect(tx.inventoryBalance.updateMany).toHaveBeenCalled();
    expect(tx.customer.updateMany).not.toHaveBeenCalled();
  });

  it('cancel blocked with 409 SAL_SO_ALREADY_SHIPPED when any line is shipped', async () => {
    const tx = makeCancelTx('approved', { shippedQty: 5 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.cancel(tenantId, 'so1')).rejects.toThrow(
      'SAL_SO_ALREADY_SHIPPED',
    );
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('cancel blocked with 409 when SO is already cancelled', async () => {
    const tx = makeCancelTx('cancelled');
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.cancel(tenantId, 'so1')).rejects.toThrow(
      'SAL_SO_NOT_CANCELLABLE',
    );
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('cancel: claim count 0 (concurrent transition) → 409', async () => {
    const tx = makeCancelTx('approved', { claimCount: 0 });
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(service.cancel(tenantId, 'so1')).rejects.toThrow(
      'SAL_SO_NOT_CANCELLABLE',
    );
    expect(tx.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  // ── create: Decimal money math + branch validation ─────────────

  const makeCreateTx = (overrides: Record<string, any> = {}) => ({
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'c1', isActive: true }),
    },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ id: 'w1', isActive: true }),
    },
    branch: { findFirst: jest.fn().mockResolvedValue(null) },
    item: {
      findFirst: jest.fn().mockResolvedValue({ id: 'i1', isSellable: true }),
    },
    salesOrder: {
      create: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: 'so1', ...args.data }),
        ),
    },
    ...overrides,
  });

  it('create computes exact 2dp Decimal totals (no float drift)', async () => {
    const tx = makeCreateTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(tenantId, 'user-uuid', {
      customerId: 'c1',
      warehouseId: 'w1',
      lines: [
        // 3 × 0.1 = 0.30000000000000004 in floats — must be exactly 0.30
        { itemId: 'i1', quantity: 3, uom: 'PCS', unitPrice: 0.1 },
        // 19.99 × 0.875 = 17.49125 → 17.49; tax 8.25% → 1.442925 → 1.44
        {
          itemId: 'i1',
          quantity: 1,
          uom: 'PCS',
          unitPrice: 19.99,
          discountPct: 12.5,
          taxRate: 8.25,
        },
      ],
    });

    const data = tx.salesOrder.create.mock.calls[0][0].data;
    expect(data.subTotal).toBeInstanceOf(Prisma.Decimal);
    expect(data.subTotal.toFixed(2)).toBe('17.79'); // 0.30 + 17.49
    expect(data.taxAmount.toFixed(2)).toBe('1.44');
    expect(data.grandTotal.toFixed(2)).toBe('19.23');

    const lines = data.lines.create;
    expect(lines[0].lineTotal.toFixed(2)).toBe('0.30');
    expect(lines[1].lineTotal.toFixed(2)).toBe('17.49');
  });

  it('create rejects unknown branchId with 404 ORG_BRANCH_NOT_FOUND', async () => {
    const tx = makeCreateTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(tenantId, 'user-uuid', {
        customerId: 'c1',
        warehouseId: 'w1',
        branchId: 'branch-x',
        lines: [{ itemId: 'i1', quantity: 1, uom: 'PCS', unitPrice: 10 }],
      }),
    ).rejects.toThrow('ORG_BRANCH_NOT_FOUND');
    expect(tx.branch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'branch-x', tenantId },
      }),
    );
  });

  // ── findOne field whitelist ─────────────────────────────────────

  it('findOne applies the role field whitelist and still includes lines', async () => {
    prisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so1',
      soNumber: 'SO-1',
      lines: [],
    });

    await service.findOne(tenantId, 'so1', ['admin'], 'id,soNumber');

    const args = prisma.salesOrder.findFirst.mock.calls[0][0];
    expect(args.select).toEqual({
      id: true,
      soNumber: true,
      lines: { orderBy: { sortOrder: 'asc' } },
    });
    expect(args.include).toBeUndefined();
  });

  it('findOne rejects fields outside the role whitelist', async () => {
    await expect(
      service.findOne(tenantId, 'so1', ['viewer'], 'notes'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.salesOrder.findFirst).not.toHaveBeenCalled();
  });
});
