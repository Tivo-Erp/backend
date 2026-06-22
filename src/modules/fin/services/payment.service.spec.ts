import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { JournalBatchService } from './journal-batch.service.js';
import { OutboxService } from '../../../infra/events/outbox.service.js';

const makePrisma = () => ({ $transaction: jest.fn() });

describe('PaymentService', () => {
  let service: PaymentService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('PAY-2026-00001'),
  };
  const journals = { createPosted: jest.fn().mockResolvedValue({ id: 'jb1' }) };

  const tenantId = 'tenant-uuid';
  const userId = 'user-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
        { provide: JournalBatchService, useValue: journals },
        { provide: OutboxService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get(PaymentService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('PAY-2026-00001');
    journals.createPosted.mockResolvedValue({ id: 'jb1' });
  });

  describe('create', () => {
    const makeTx = (invoice: any = null) => ({
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 's1' }) },
      invoice: {
        findFirst: jest.fn().mockResolvedValue(
          invoice ?? {
            id: 'inv1',
            balanceDue: 1000,
            partyId: 'c1',
            partyType: 'customer',
            invoiceType: 'sales',
          },
        ),
      },
      payment: {
        create: jest
          .fn()
          .mockImplementation((args: any) =>
            Promise.resolve({ id: 'p1', ...args.data }),
          ),
      },
    });

    const baseDto = {
      direction: 'inbound',
      counterpartyId: 'c1',
      counterpartyType: 'customer',
      amount: 1000,
      paymentMethod: 'bank_transfer',
      paymentDate: '2026-06-20',
    };

    it('creates payment and records total allocated', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.create(tenantId, userId, {
        ...baseDto,
        allocations: [{ invoiceId: 'inv1', allocatedAmount: 600 }],
      });

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            allocatedAmount: 600,
            status: 'draft',
          }),
        }),
      );
    });

    it('throws 400 when total allocated exceeds payment amount', async () => {
      const tx = makeTx({
        id: 'inv1',
        balanceDue: 2000,
        partyId: 'c1',
        partyType: 'customer',
        invoiceType: 'sales',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          paymentMethod: 'cash',
          allocations: [{ invoiceId: 'inv1', allocatedAmount: 1500 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when allocation exceeds invoice balance', async () => {
      const tx = makeTx({
        id: 'inv1',
        balanceDue: 500,
        partyId: 'c1',
        partyType: 'customer',
        invoiceType: 'sales',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          paymentMethod: 'cash',
          allocations: [{ invoiceId: 'inv1', allocatedAmount: 800 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when duplicate invoice allocations summed exceed balance', async () => {
      // Each line (600) fits within balanceDue 1000, but their sum (1200) does not.
      const tx = makeTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          amount: 2000,
          allocations: [
            { invoiceId: 'inv1', allocatedAmount: 600 },
            { invoiceId: 'inv1', allocatedAmount: 600 },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('throws 400 FIN_PAYMENT_DIRECTION_MISMATCH (inbound + supplier)', async () => {
      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          counterpartyType: 'supplier',
          counterpartyId: 's1',
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 400 FIN_PAYMENT_DIRECTION_MISMATCH (outbound + customer)', async () => {
      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          direction: 'outbound',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 FIN_PAYMENT_INVOICE_MISMATCH when invoice belongs to another party', async () => {
      const tx = makeTx({
        id: 'inv1',
        balanceDue: 1000,
        partyId: 'other-customer',
        partyType: 'customer',
        invoiceType: 'sales',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          allocations: [{ invoiceId: 'inv1', allocatedAmount: 500 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 FIN_PAYMENT_INVOICE_MISMATCH when invoice type does not match direction', async () => {
      // Inbound (customer receipt) must settle AR/sales invoices, not AP/purchase.
      const tx = makeTx({
        id: 'inv1',
        balanceDue: 1000,
        partyId: 'c1',
        partyType: 'customer',
        invoiceType: 'purchase',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.create(tenantId, userId, {
          ...baseDto,
          allocations: [{ invoiceId: 'inv1', allocatedAmount: 500 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('post', () => {
    const inboundPayment = {
      id: 'p1',
      status: 'draft',
      direction: 'inbound',
      counterpartyType: 'customer',
      counterpartyId: 'c1',
      amount: 1000,
      paymentNumber: 'PAY-1',
      paymentDate: new Date('2026-06-20'),
      allocations: [{ invoiceId: 'inv1', allocatedAmount: 1000 }],
    };

    const makePostTx = () => ({
      payment: {
        findFirst: jest.fn().mockResolvedValue(inboundPayment),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'p1', status: 'posted' }),
      },
      invoice: {
        findFirst: jest
          .fn()
          // re-validation read
          .mockResolvedValueOnce({
            id: 'inv1',
            balanceDue: 1000,
            partyId: 'c1',
            invoiceType: 'sales',
          })
          // post-update read for status transition
          .mockResolvedValueOnce({ id: 'inv1', balanceDue: 0 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      customer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supplier: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    });

    it('claims draft, applies allocation, marks invoice paid, auto-journals (inbound Dr112/Cr131)', async () => {
      const tx = makePostTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.post(tenantId, 'p1', userId);

      expect(tx.payment.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId, status: 'draft' },
        data: { status: 'posted' },
      });
      // guarded conditional allocation
      expect(tx.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv1', tenantId, balanceDue: { gte: 1000 } },
        data: {
          amountPaid: { increment: 1000 },
          balanceDue: { decrement: 1000 },
        },
      });
      // status transition derived from re-read
      expect(tx.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv1', tenantId },
        data: { status: 'paid' },
      });
      expect(journals.createPosted).toHaveBeenCalledWith(
        tx,
        tenantId,
        userId,
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ accountCode: '112', debitAmount: 1000 }),
            expect.objectContaining({ accountCode: '131', creditAmount: 1000 }),
          ]),
        }),
      );
      // customer creditUsed decremented (guarded)
      expect(tx.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', tenantId, creditUsed: { gte: 1000 } },
        data: { creditUsed: { decrement: 1000 } },
      });
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ journalBatchId: 'jb1' }),
        }),
      );
    });

    it('marks invoice partially_paid when balance remains', async () => {
      const tx = makePostTx();
      tx.payment.findFirst.mockResolvedValue({
        ...inboundPayment,
        allocations: [{ invoiceId: 'inv1', allocatedAmount: 400 }],
      });
      tx.invoice.findFirst
        .mockReset()
        .mockResolvedValueOnce({
          id: 'inv1',
          balanceDue: 1000,
          partyId: 'c1',
          invoiceType: 'sales',
        })
        .mockResolvedValueOnce({ id: 'inv1', balanceDue: 600 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.post(tenantId, 'p1', userId);

      expect(tx.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv1', tenantId },
        data: { status: 'partially_paid' },
      });
    });

    it('outbound payment journals Dr331/Cr112 and decrements supplier creditUsed', async () => {
      const tx = makePostTx();
      tx.payment.findFirst.mockResolvedValue({
        ...inboundPayment,
        direction: 'outbound',
        counterpartyType: 'supplier',
        counterpartyId: 's1',
        allocations: [],
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.post(tenantId, 'p1', userId);

      expect(journals.createPosted).toHaveBeenCalledWith(
        tx,
        tenantId,
        userId,
        expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({ accountCode: '331', debitAmount: 1000 }),
            expect.objectContaining({ accountCode: '112', creditAmount: 1000 }),
          ]),
        }),
      );
      expect(tx.supplier.updateMany).toHaveBeenCalledWith({
        where: { id: 's1', tenantId, creditUsed: { gte: 1000 } },
        data: { creditUsed: { decrement: 1000 } },
      });
      expect(tx.customer.updateMany).not.toHaveBeenCalled();
    });

    it('supplier creditUsed is floored at 0 when smaller than payment amount', async () => {
      const tx = makePostTx();
      tx.payment.findFirst.mockResolvedValue({
        ...inboundPayment,
        direction: 'outbound',
        counterpartyType: 'supplier',
        counterpartyId: 's1',
        allocations: [],
      });
      // guarded decrement misses (creditUsed < amount) → second call floors to 0
      tx.supplier.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.post(tenantId, 'p1', userId);

      expect(tx.supplier.updateMany).toHaveBeenLastCalledWith({
        where: { id: 's1', tenantId },
        data: { creditUsed: 0 },
      });
    });

    it('customer creditUsed is floored at 0 when smaller than payment amount', async () => {
      const tx = makePostTx();
      tx.customer.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.post(tenantId, 'p1', userId);

      expect(tx.customer.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'c1', tenantId },
        data: { creditUsed: 0 },
      });
    });

    it('throws 409 when payment not in draft', async () => {
      const tx = makePostTx();
      tx.payment.findFirst.mockResolvedValue({
        ...inboundPayment,
        status: 'posted',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'p1', userId)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.payment.updateMany).not.toHaveBeenCalled();
    });

    it('double-post race: claim count 0 → 409, no side effects', async () => {
      const tx = makePostTx();
      tx.payment.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'p1', userId)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.invoice.updateMany).not.toHaveBeenCalled();
      expect(journals.createPosted).not.toHaveBeenCalled();
      expect(tx.customer.updateMany).not.toHaveBeenCalled();
    });

    it('post-time re-validation: allocation exceeding current balance → 400 (no clamp)', async () => {
      const tx = makePostTx();
      // invoice balance shrank to 400 since the draft was created
      tx.invoice.findFirst.mockReset().mockResolvedValue({
        id: 'inv1',
        balanceDue: 400,
        partyId: 'c1',
        invoiceType: 'sales',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'p1', userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.invoice.updateMany).not.toHaveBeenCalled();
      expect(journals.createPosted).not.toHaveBeenCalled();
    });

    it('post-time duplicate allocations are summed per invoice', async () => {
      const tx = makePostTx();
      tx.payment.findFirst.mockResolvedValue({
        ...inboundPayment,
        amount: 2000,
        allocations: [
          { invoiceId: 'inv1', allocatedAmount: 600 },
          { invoiceId: 'inv1', allocatedAmount: 600 },
        ],
      });
      // summed 1200 > balanceDue 1000 → 400
      tx.invoice.findFirst.mockReset().mockResolvedValue({
        id: 'inv1',
        balanceDue: 1000,
        partyId: 'c1',
        invoiceType: 'sales',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'p1', userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.invoice.updateMany).not.toHaveBeenCalled();
    });

    it('guarded invoice update losing the race → 400 instead of clamping', async () => {
      const tx = makePostTx();
      tx.invoice.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'p1', userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(journals.createPosted).not.toHaveBeenCalled();
    });
  });
});
