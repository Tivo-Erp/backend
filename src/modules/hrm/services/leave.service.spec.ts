import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LeaveService } from './leave.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { NotificationService } from '../../ntf/services/notification.service.js';
import { OutboxService } from '../../../infra/events/outbox.service.js';

const makePrisma = () => ({
  leaveRequest: { findFirst: jest.fn(), updateMany: jest.fn() },
  leaveBalance: { findFirst: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
});

describe('LeaveService', () => {
  let service: LeaveService;
  let prisma: ReturnType<typeof makePrisma>;
  const notifications = { create: jest.fn() };
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: NotificationService, useValue: notifications },
        { provide: OutboxService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    service = module.get(LeaveService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('workingDays', () => {
    it('counts inclusive weekdays excluding weekends', () => {
      // 2026-06-01 (Mon) .. 2026-06-05 (Fri) = 5
      expect(
        service.workingDays(
          new Date('2026-06-01'),
          new Date('2026-06-05'),
          'full_day',
        ),
      ).toBe(5);
    });

    it('skips the weekend in a spanning range', () => {
      // 2026-06-05 (Fri) .. 2026-06-08 (Mon) = Fri + Mon = 2
      expect(
        service.workingDays(
          new Date('2026-06-05'),
          new Date('2026-06-08'),
          'full_day',
        ),
      ).toBe(2);
    });

    it('returns 0.5 for a single-day half-day request', () => {
      expect(
        service.workingDays(
          new Date('2026-06-01'),
          new Date('2026-06-01'),
          'morning',
        ),
      ).toBe(0.5);
    });

    it('returns 0 for a weekend-only day', () => {
      // 2026-06-06 is Saturday
      expect(
        service.workingDays(
          new Date('2026-06-06'),
          new Date('2026-06-06'),
          'full_day',
        ),
      ).toBe(0);
    });
  });

  describe('createRequest', () => {
    const dto: any = {
      employeeId: 'e1',
      leaveTypeId: 'lt1',
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      halfDay: 'full_day',
    };

    it('rejects when the available balance is insufficient', async () => {
      const tx = {
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: 'e1', userId: 'u1' }),
        },
        leaveType: {
          findFirst: jest.fn().mockResolvedValue({ id: 'lt1', defaultDays: 1 }),
        },
        leaveBalance: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'lb1',
            entitlement: '1',
            carryOver: '0',
            used: '0',
          }),
          create: jest.fn(),
        },
        leaveRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      // 2026-07-01..03 = Wed,Thu,Fri = 3 days > 1 available
      await expect(service.createRequest(tenantId, dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects dates overlapping an existing pending/approved request', async () => {
      const tx = {
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: 'e1', userId: 'u1' }),
        },
        leaveType: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'lt1', defaultDays: 12 }),
        },
        leaveRequest: {
          findFirst: jest.fn().mockResolvedValue({ id: 'lr-existing' }),
          create: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(service.createRequest(tenantId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tx.leaveRequest.create).not.toHaveBeenCalled();
    });

    it('rejects a half-day request spanning multiple days', async () => {
      await expect(
        service.createRequest(tenantId, { ...dto, halfDay: 'morning' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('auto-creates a balance from the leave type default when missing', async () => {
      const tx = {
        employee: {
          findFirst: jest.fn().mockResolvedValue({ id: 'e1', userId: 'u1' }),
        },
        leaveType: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'lt1', defaultDays: 12 }),
        },
        leaveBalance: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'lb1',
            entitlement: '12',
            carryOver: '0',
            used: '0',
          }),
        },
        leaveRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest
            .fn()
            .mockImplementation((a: any) => ({ id: 'lr1', ...a.data })),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const req: any = await service.createRequest(tenantId, dto);
      expect(tx.leaveBalance.create).toHaveBeenCalled();
      expect(req.status).toBe('pending');
      expect(Number(req.totalDays)).toBe(3);
    });
  });

  describe('approve', () => {
    const pendingReq = {
      id: 'lr1',
      status: 'pending',
      employeeId: 'e1',
      leaveTypeId: 'lt1',
      startDate: new Date('2026-07-01'),
      totalDays: '3',
    };

    it('deducts the balance (guarded raw update) and marks approved', async () => {
      const tx = {
        leaveRequest: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(pendingReq)
            .mockResolvedValueOnce({ id: 'lr1', status: 'approved' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        leaveBalance: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'lb1',
            entitlement: '12',
            carryOver: '0',
            used: '0',
          }),
        },
        employee: { findFirst: jest.fn().mockResolvedValue({ userId: 'u1' }) },
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await service.approve(tenantId, 'lr1', 'mgr1', {});
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(notifications.create).toHaveBeenCalled();
    });

    it('conflicts when the guarded deduction loses a concurrent overdraw race', async () => {
      const tx = {
        leaveRequest: {
          findFirst: jest.fn().mockResolvedValue(pendingReq),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        leaveBalance: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'lb1',
            entitlement: '12',
            carryOver: '0',
            used: '0',
          }),
        },
        employee: { findFirst: jest.fn() },
        $executeRaw: jest.fn().mockResolvedValue(0),
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.approve(tenantId, 'lr1', 'mgr1', {} as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('rejects a non-pending request', async () => {
      const tx = {
        leaveRequest: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'lr1', status: 'approved' }),
        },
        leaveBalance: { findFirst: jest.fn() },
        employee: { findFirst: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.approve(tenantId, 'lr1', 'mgr1', {} as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
