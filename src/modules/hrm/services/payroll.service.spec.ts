import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PayrollService } from './payroll.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { JournalBatchService } from '../../fin/services/journal-batch.service.js';

const makePrisma = () => ({
  payrollRun: { findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  payrollLine: { findMany: jest.fn() },
  employee: { findMany: jest.fn() },
  $transaction: jest.fn(),
});

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: ReturnType<typeof makePrisma>;
  const journals = { createPosted: jest.fn() };
  const tenantId = 't1';
  const userId = 'u1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: JournalBatchService, useValue: journals },
      ],
    }).compile();
    service = module.get(PayrollService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('calculate', () => {
    it('refuses a duplicate run for the same period', async () => {
      const tx = { payrollRun: { findFirst: jest.fn().mockResolvedValue({ id: 'pr1' }) } };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.calculate(tenantId, userId, { month: 6, year: 2026 } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('computes lines for all active employees and aggregates totals', async () => {
      const tx = {
        payrollRun: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((a: any) => ({ id: 'pr1', ...a.data })),
        },
        employee: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'e1', basicSalary: '20000000', numberOfDependents: 1 },
            { id: 'e2', basicSalary: '10000000', numberOfDependents: 0 },
          ]),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const run: any = await service.calculate(tenantId, userId, {
        month: 6, year: 2026,
      } as any);
      expect(run.employeeCount).toBe(2);
      expect(Number(run.totalGross)).toBe(30_000_000);
      expect(run.status).toBe('draft');
    });
  });

  describe('approve', () => {
    it('creates a balanced posted journal and marks approved', async () => {
      // Self-consistent totals matching the single line below:
      //  empIns 2.1M, emplrIns 4.3M, gross 22M, pit 225k → net 19.675M
      const run = {
        id: 'pr1', status: 'draft', year: 2026, month: 6,
        totalGross: '22000000', totalNet: '19675000', totalPIT: '225000',
        totalInsEmp: '2100000', totalInsEmpl: '4300000',
      };
      const tx = {
        payrollRun: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(run)
            .mockResolvedValueOnce({ ...run, status: 'approved' }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        payrollLine: {
          findMany: jest.fn().mockResolvedValue([
            { empBHXH: '1600000', empBHYT: '300000', empBHTN: '200000', emplrBHXH: '3500000', emplrBHYT: '600000', emplrBHTN: '200000' },
          ]),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      journals.createPosted.mockResolvedValue({ id: 'jb1' });

      await service.approve(tenantId, 'pr1', userId);

      const callArg = journals.createPosted.mock.calls[0][3];
      const totalDebit = callArg.entries.reduce(
        (s: number, e: any) => s + Number(e.debitAmount), 0,
      );
      const totalCredit = callArg.entries.reduce(
        (s: number, e: any) => s + Number(e.creditAmount), 0,
      );
      expect(totalDebit).toBe(totalCredit); // balanced double-entry
      expect(totalDebit).toBe(26_300_000); // gross 22M + employer insurance 4.3M
      expect(tx.payrollRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'approved', journalBatchId: 'jb1' } }),
      );
    });

    it('rejects approving a non-draft run', async () => {
      const tx = {
        payrollRun: { findFirst: jest.fn().mockResolvedValue({ id: 'pr1', status: 'approved' }) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(service.approve(tenantId, 'pr1', userId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
