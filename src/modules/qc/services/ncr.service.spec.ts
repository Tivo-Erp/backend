import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NcrService } from './ncr.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({
  nCRReport: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  user: { findFirst: jest.fn() },
  $transaction: jest.fn(),
});

describe('NcrService', () => {
  let service: NcrService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('NCR-2026-00001'),
  };
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NcrService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();
    service = module.get(NcrService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    sequences.getNextNumber.mockResolvedValue('NCR-2026-00001');
  });

  describe('create', () => {
    it('rejects an assignee outside the tenant', async () => {
      const tx = {
        user: { findFirst: jest.fn().mockResolvedValue(null) },
        nCRReport: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, 'u1', {
          description: 'dent on housing',
          disposition: 'rework',
          assignedTo: 'foreign-user',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.nCRReport.create).not.toHaveBeenCalled();
    });

    it('creates an open NCR with server-assigned number', async () => {
      const tx = {
        nCRReport: {
          create: jest
            .fn()
            .mockImplementation((a: any) => ({ id: 'n1', ...a.data })),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const ncr: any = await service.create(tenantId, 'u1', {
        description: 'dent on housing',
        disposition: 'rework',
      });
      expect(ncr.ncrNumber).toBe('NCR-2026-00001');
      expect(ncr.status).toBe('open');
    });
  });

  describe('update', () => {
    it('refuses to modify a closed NCR (guarded update)', async () => {
      prisma.nCRReport.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.nCRReport.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.update(tenantId, 'n1', { disposition: 'scrap' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.nCRReport.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'n1', tenantId, status: { not: 'closed' } },
        }),
      );
    });

    it('updates disposition/status on an open NCR', async () => {
      prisma.nCRReport.findFirst
        .mockResolvedValueOnce({ id: 'n1' })
        .mockResolvedValueOnce({
          id: 'n1',
          disposition: 'scrap',
          status: 'in_progress',
        });
      prisma.nCRReport.updateMany.mockResolvedValue({ count: 1 });
      const ncr: any = await service.update(tenantId, 'n1', {
        disposition: 'scrap',
        status: 'in_progress',
      });
      expect(ncr.disposition).toBe('scrap');
    });
  });
});
