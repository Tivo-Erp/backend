import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JournalBatchService } from './journal-batch.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FiscalPeriodService } from './fiscal-period.service.js';

const makePrisma = () => ({
  journalBatch: { findFirst: jest.fn(), deleteMany: jest.fn() },
  $transaction: jest.fn(),
});

describe('JournalBatchService', () => {
  let service: JournalBatchService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('JB-2026-00001'),
  };
  const fiscalPeriods = { assertOpen: jest.fn().mockResolvedValue(undefined) };

  const tenantId = 'tenant-uuid';
  const userId = 'user-uuid';

  const balanced = [
    { accountCode: '131', debitAmount: 1000, creditAmount: 0 },
    { accountCode: '511', debitAmount: 0, creditAmount: 1000 },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalBatchService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
        { provide: FiscalPeriodService, useValue: fiscalPeriods },
      ],
    }).compile();

    service = module.get(JournalBatchService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    fiscalPeriods.assertOpen.mockResolvedValue(undefined);
    sequences.getNextNumber.mockResolvedValue('JB-2026-00001');
  });

  const makeTx = (accountsFound = ['131', '511']) => ({
    chartOfAccount: {
      findMany: jest
        .fn()
        .mockResolvedValue(accountsFound.map((c) => ({ accountCode: c }))),
    },
    journalBatch: {
      create: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: 'jb1', ...args.data }),
        ),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    journalEntry: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  });

  it('creates a balanced draft journal', async () => {
    const tx = makeTx();
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await service.create(tenantId, userId, {
      journalDate: '2026-06-15',
      sourceType: 'manual',
      entries: balanced,
    } as any);

    expect(tx.journalBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalDebit: 1000,
          totalCredit: 1000,
          status: 'draft',
        }),
      }),
    );
  });

  it('throws 400 FIN_JOURNAL_UNBALANCED', async () => {
    await expect(
      service.create(tenantId, userId, {
        journalDate: '2026-06-15',
        sourceType: 'manual',
        entries: [
          { accountCode: '131', debitAmount: 1000, creditAmount: 0 },
          { accountCode: '511', debitAmount: 0, creditAmount: 500 },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when a line has both debit and credit', async () => {
    await expect(
      service.create(tenantId, userId, {
        journalDate: '2026-06-15',
        sourceType: 'manual',
        entries: [
          { accountCode: '131', debitAmount: 100, creditAmount: 100 },
          { accountCode: '511', debitAmount: 0, creditAmount: 0 },
        ],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when fewer than two entries', async () => {
    await expect(
      service.create(tenantId, userId, {
        journalDate: '2026-06-15',
        sourceType: 'manual',
        entries: [{ accountCode: '131', debitAmount: 0, creditAmount: 0 }],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 404 when account code not found', async () => {
    const tx = makeTx(['131']); // 511 missing
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await expect(
      service.create(tenantId, userId, {
        journalDate: '2026-06-15',
        sourceType: 'manual',
        entries: balanced,
      } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('propagates FIN_PERIOD_CLOSED from fiscal period check', async () => {
    fiscalPeriods.assertOpen.mockRejectedValue(
      new ConflictException('FIN_PERIOD_CLOSED'),
    );
    await expect(
      service.create(tenantId, userId, {
        journalDate: '2026-06-15',
        sourceType: 'manual',
        entries: balanced,
      } as any),
    ).rejects.toThrow(ConflictException);
  });

  describe('post', () => {
    const draftBatch = {
      id: 'jb1',
      status: 'draft',
      journalDate: new Date('2026-06-15'),
      entries: [],
    };

    it('draft → posted via race-safe claim, period checked', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(draftBatch);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.post(tenantId, 'jb1', userId);

      expect(fiscalPeriods.assertOpen).toHaveBeenCalledWith(
        tenantId,
        draftBatch.journalDate,
      );
      expect(tx.journalBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'jb1', tenantId, status: 'draft' },
          data: expect.objectContaining({ status: 'posted', postedBy: userId }),
        }),
      );
    });

    it('throws 409 when not draft', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue({
        ...draftBatch,
        status: 'posted',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'jb1', userId)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.journalBatch.updateMany).not.toHaveBeenCalled();
    });

    it('blocked when fiscal period of journalDate is closed', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(draftBatch);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      fiscalPeriods.assertOpen.mockRejectedValue(
        new ConflictException('FIN_PERIOD_CLOSED'),
      );

      await expect(service.post(tenantId, 'jb1', userId)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.journalBatch.updateMany).not.toHaveBeenCalled();
    });

    it('double-post race: claim count 0 → 409', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(draftBatch);
      tx.journalBatch.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.post(tenantId, 'jb1', userId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reverse', () => {
    const postedBatch = {
      id: 'jb1',
      status: 'posted',
      batchNumber: 'JB-1',
      sourceType: 'manual',
      sourceId: null,
      totalDebit: 1000,
      totalCredit: 1000,
      entries: [
        {
          accountCode: '131',
          description: 'x',
          debitAmount: 1000,
          creditAmount: 0,
          costCenterId: null,
        },
        {
          accountCode: '511',
          description: 'y',
          debitAmount: 0,
          creditAmount: 1000,
          costCenterId: null,
        },
      ],
    };

    it('creates mirrored batch and claims original posted → reversed', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(postedBatch);
      tx.journalBatch.create.mockResolvedValue({ id: 'jb2', entries: [] });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.reverse(tenantId, 'jb1', userId);

      // The reversal is dated now — its period must be open
      expect(fiscalPeriods.assertOpen).toHaveBeenCalledWith(
        tenantId,
        expect.any(Date),
      );
      expect(tx.journalBatch.updateMany).toHaveBeenCalledWith({
        where: { id: 'jb1', tenantId, status: 'posted' },
        data: { status: 'reversed' },
      });
      expect(tx.journalBatch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reversalOf: 'jb1',
            totalDebit: 1000,
            totalCredit: 1000,
            status: 'posted',
          }),
        }),
      );
    });

    it('blocked when current (reversal-date) period is closed', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(postedBatch);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      fiscalPeriods.assertOpen.mockRejectedValue(
        new ConflictException('FIN_PERIOD_CLOSED'),
      );

      await expect(service.reverse(tenantId, 'jb1', userId)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.journalBatch.create).not.toHaveBeenCalled();
    });

    it('double-reverse race: claim count 0 → 409', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(postedBatch);
      tx.journalBatch.updateMany.mockResolvedValue({ count: 0 });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(service.reverse(tenantId, 'jb1', userId)).rejects.toThrow(
        ConflictException,
      );
      expect(tx.journalBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('update (PATCH draft)', () => {
    const draftBatch = {
      id: 'jb1',
      status: 'draft',
      journalDate: new Date('2026-06-15'),
      entries: [],
    };

    it('updates a draft and replaces entries with recomputed totals', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(draftBatch);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await service.update(tenantId, 'jb1', userId, {
        description: 'updated',
        entries: [
          { accountCode: '131', debitAmount: 2000, creditAmount: 0 },
          { accountCode: '511', debitAmount: 0, creditAmount: 2000 },
        ],
      });

      expect(fiscalPeriods.assertOpen).toHaveBeenCalledWith(
        tenantId,
        draftBatch.journalDate,
      );
      expect(tx.journalBatch.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'jb1', tenantId, status: 'draft' },
          data: expect.objectContaining({
            description: 'updated',
            totalDebit: 2000,
            totalCredit: 2000,
          }),
        }),
      );
      expect(tx.journalEntry.deleteMany).toHaveBeenCalledWith({
        where: { batchId: 'jb1' },
      });
      expect(tx.journalEntry.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ accountCode: '131', debitAmount: 2000 }),
          ]),
        }),
      );
    });

    it('throws 400 when replacement entries are unbalanced', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(draftBatch);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.update(tenantId, 'jb1', userId, {
          entries: [
            { accountCode: '131', debitAmount: 2000, creditAmount: 0 },
            { accountCode: '511', debitAmount: 0, creditAmount: 100 },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(tx.journalBatch.updateMany).not.toHaveBeenCalled();
    });

    it('throws 409 when batch is not draft', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue({
        ...draftBatch,
        status: 'posted',
      });
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.update(tenantId, 'jb1', userId, { description: 'x' } as any),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 404 when batch not found', async () => {
      const tx = makeTx();
      tx.journalBatch.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      await expect(
        service.update(tenantId, 'jb1', userId, { description: 'x' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (DELETE draft)', () => {
    it('hard-deletes a draft batch', async () => {
      prisma.journalBatch.findFirst.mockResolvedValue({
        id: 'jb1',
        status: 'draft',
      });
      prisma.journalBatch.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(tenantId, 'jb1');

      expect(prisma.journalBatch.deleteMany).toHaveBeenCalledWith({
        where: { id: 'jb1', tenantId, status: 'draft' },
      });
    });

    it('throws 409 when batch is not draft', async () => {
      prisma.journalBatch.findFirst.mockResolvedValue({
        id: 'jb1',
        status: 'posted',
      });

      await expect(service.remove(tenantId, 'jb1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.journalBatch.deleteMany).not.toHaveBeenCalled();
    });

    it('throws 404 when batch not found', async () => {
      prisma.journalBatch.findFirst.mockResolvedValue(null);
      await expect(service.remove(tenantId, 'jb1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
