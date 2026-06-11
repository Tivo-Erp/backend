import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FiscalPeriodService } from './fiscal-period.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const makePrisma = () => ({
  fiscalPeriod: {
    createMany: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  journalBatch: { count: jest.fn() },
});

describe('FiscalPeriodService', () => {
  let service: FiscalPeriodService;
  let prisma: ReturnType<typeof makePrisma>;
  const tenantId = 'tenant-uuid';
  const userId = 'user-uuid';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalPeriodService,
        { provide: PrismaService, useFactory: makePrisma },
      ],
    }).compile();
    service = module.get(FiscalPeriodService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  it('init creates 12 monthly periods', async () => {
    prisma.fiscalPeriod.createMany.mockResolvedValue({ count: 12 });
    const result = await service.init(tenantId, { year: 2026 });
    expect(prisma.fiscalPeriod.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ month: 1 }),
          expect.objectContaining({ month: 12 }),
        ]),
      }),
    );
    expect(result.created).toBe(12);
  });

  it('close throws 409 when previous period still open', async () => {
    prisma.fiscalPeriod.findFirst
      .mockResolvedValueOnce({ id: 'fp', year: 2026, month: 6, status: 'open' }) // target
      .mockResolvedValueOnce({
        id: 'fp-prev',
        year: 2026,
        month: 5,
        status: 'open',
      }); // previous
    await expect(service.close(tenantId, 'fp', userId)).rejects.toThrow(
      ConflictException,
    );
  });

  it('close throws 409 when draft journals exist in period', async () => {
    prisma.fiscalPeriod.findFirst
      .mockResolvedValueOnce({ id: 'fp', year: 2026, month: 6, status: 'open' })
      .mockResolvedValueOnce({
        id: 'fp-prev',
        year: 2026,
        month: 5,
        status: 'closed',
      });
    prisma.journalBatch.count.mockResolvedValue(2);
    await expect(service.close(tenantId, 'fp', userId)).rejects.toThrow(
      ConflictException,
    );
  });

  it('close succeeds when previous closed and no draft journals', async () => {
    prisma.fiscalPeriod.findFirst
      .mockResolvedValueOnce({ id: 'fp', year: 2026, month: 6, status: 'open' })
      .mockResolvedValueOnce({
        id: 'fp-prev',
        year: 2026,
        month: 5,
        status: 'closed',
      });
    prisma.journalBatch.count.mockResolvedValue(0);
    await service.close(tenantId, 'fp', userId);
    expect(prisma.fiscalPeriod.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'closed', closedBy: userId }),
      }),
    );
  });

  it('close throws 404 when period not found', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValueOnce(null);
    await expect(service.close(tenantId, 'fp', userId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('assertOpen throws FIN_PERIOD_CLOSED for a closed period', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue({
      id: 'fp',
      status: 'closed',
    });
    await expect(
      service.assertOpen(tenantId, new Date('2026-06-15')),
    ).rejects.toThrow('FIN_PERIOD_CLOSED');
  });

  it('assertOpen throws FIN_PERIOD_NOT_INITIALIZED when no period row exists', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue(null);
    await expect(
      service.assertOpen(tenantId, new Date('2026-06-15')),
    ).rejects.toThrow('FIN_PERIOD_NOT_INITIALIZED');
    await expect(
      service.assertOpen(tenantId, new Date('2026-06-15')),
    ).rejects.toThrow(ConflictException);
  });

  it('assertOpen resolves for an open period', async () => {
    prisma.fiscalPeriod.findFirst.mockResolvedValue({
      id: 'fp',
      status: 'open',
    });
    await expect(
      service.assertOpen(tenantId, new Date('2026-06-15')),
    ).resolves.toBeUndefined();
  });
});
