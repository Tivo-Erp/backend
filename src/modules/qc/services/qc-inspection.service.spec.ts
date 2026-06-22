import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QcInspectionService } from './qc-inspection.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';

const makePrisma = () => ({
  qCInspection: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
});

describe('QcInspectionService.submitResults', () => {
  let service: QcInspectionService;
  let prisma: ReturnType<typeof makePrisma>;
  const sequences = {
    getNextNumber: jest.fn().mockResolvedValue('QC-2026-00001'),
  };
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QcInspectionService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: DocumentSequenceService, useValue: sequences },
      ],
    }).compile();
    service = module.get(QcInspectionService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  const results = [{ criterionName: 'dim', passed: true }];

  function txFor(inspection: any, finalStatus: string) {
    return {
      qCInspection: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(inspection)
          .mockResolvedValueOnce({
            ...inspection,
            status: finalStatus,
            results: [],
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      qCInspectionResult: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
  }

  it('rejects when accepted + rejected does not equal totalQty', async () => {
    const tx = txFor(
      { id: 'qc1', status: 'pending', totalQty: '100' },
      'passed',
    );
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(
      service.submitResults(tenantId, 'insp1', 'qc1', {
        acceptedQty: 90,
        rejectedQty: 5,
        results,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('derives "passed" when nothing is rejected', async () => {
    const tx = txFor(
      { id: 'qc1', status: 'pending', totalQty: '100' },
      'passed',
    );
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.submitResults(tenantId, 'insp1', 'qc1', {
      acceptedQty: 100,
      rejectedQty: 0,
      results,
    });
    expect(tx.qCInspection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'passed' }),
      }),
    );
  });

  it('derives "failed" when nothing is accepted', async () => {
    const tx = txFor(
      { id: 'qc1', status: 'pending', totalQty: '100' },
      'failed',
    );
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.submitResults(tenantId, 'insp1', 'qc1', {
      acceptedQty: 0,
      rejectedQty: 100,
      results,
    });
    expect(tx.qCInspection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('derives "partial_pass" on a mixed result', async () => {
    const tx = txFor(
      { id: 'qc1', status: 'pending', totalQty: '100' },
      'partial_pass',
    );
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.submitResults(tenantId, 'insp1', 'qc1', {
      acceptedQty: 95,
      rejectedQty: 5,
      results,
    });
    expect(tx.qCInspection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'partial_pass' }),
      }),
    );
  });

  it('refuses to finalize an already-finalized inspection', async () => {
    const tx = {
      qCInspection: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'qc1', status: 'passed', totalQty: '100' }),
      },
      qCInspectionResult: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(
      service.submitResults(tenantId, 'insp1', 'qc1', {
        acceptedQty: 100,
        rejectedQty: 0,
        results,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('create', () => {
    it('rejects a source document that does not exist in the tenant', async () => {
      const tx = {
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1' }) },
        goodsReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
        qCInspection: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, {
          sourceType: 'grn',
          sourceId: 'g-missing',
          itemId: 'i1',
          totalQty: 10,
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.qCInspection.create).not.toHaveBeenCalled();
    });

    it('creates a pending inspection for a tenant-owned work order', async () => {
      const tx = {
        item: { findFirst: jest.fn().mockResolvedValue({ id: 'i1' }) },
        workOrder: { findFirst: jest.fn().mockResolvedValue({ id: 'wo1' }) },
        qCInspection: {
          create: jest
            .fn()
            .mockImplementation((a: any) => ({ id: 'qc1', ...a.data })),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const insp: any = await service.create(tenantId, {
        sourceType: 'work_order',
        sourceId: 'wo1',
        itemId: 'i1',
        totalQty: 10,
      });
      expect(insp.status).toBe('pending');
      expect(tx.workOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'wo1', tenantId }),
        }),
      );
    });
  });
});
