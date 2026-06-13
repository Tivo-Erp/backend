import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TimesheetService } from './timesheet.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const makePrisma = () => ({
  timesheet: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
});

describe('TimesheetService', () => {
  let service: TimesheetService;
  let prisma: ReturnType<typeof makePrisma>;
  const tenantId = 't1';
  const userId = 'u1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimesheetService,
        { provide: PrismaService, useFactory: makePrisma },
      ],
    }).compile();
    service = module.get(TimesheetService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('rejects future-dated entries', async () => {
      const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      await expect(
        service.create(tenantId, userId, { projectId: 'p1', workDate: future, hours: 8 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('enforces the 24h/day limit across projects', async () => {
      const tx = {
        employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
        project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
        timesheet: {
          findMany: jest.fn().mockResolvedValue([{ hours: '20' }]), // 20h already logged
          create: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, userId, { projectId: 'p1', workDate: '2026-06-01', hours: 6 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.timesheet.create).not.toHaveBeenCalled();
    });

    it('404s when the user has no employee record', async () => {
      const tx = { employee: { findFirst: jest.fn().mockResolvedValue(null) } };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.create(tenantId, userId, { projectId: 'p1', workDate: '2026-06-01', hours: 8 } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('logs a draft entry within the daily limit', async () => {
      const tx = {
        employee: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
        project: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
        timesheet: {
          findMany: jest.fn().mockResolvedValue([{ hours: '4' }]),
          create: jest.fn().mockImplementation((a: any) => ({ id: 'ts1', ...a.data })),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const ts: any = await service.create(tenantId, userId, {
        projectId: 'p1', workDate: '2026-06-01', hours: 8,
      } as any);
      expect(ts.status).toBe('draft');
      expect(ts.employeeId).toBe('e1');
    });
  });

  describe('approve', () => {
    it('rejects an already-decided timesheet', async () => {
      prisma.timesheet.findFirst.mockResolvedValue({ id: 'ts1', status: 'approved' });
      await expect(
        service.approve(tenantId, 'ts1', 'mgr1', { approved: true } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('approves a draft timesheet (guarded claim)', async () => {
      prisma.timesheet.findFirst.mockResolvedValue({ id: 'ts1', status: 'draft' });
      prisma.timesheet.updateMany.mockResolvedValue({ count: 1 });
      await service.approve(tenantId, 'ts1', 'mgr1', { approved: true } as any);
      expect(prisma.timesheet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'approved', approvedBy: 'mgr1' }) }),
      );
    });
  });
});
