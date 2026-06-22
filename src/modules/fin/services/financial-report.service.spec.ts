import { Test, TestingModule } from '@nestjs/testing';
import { FinancialReportService } from './financial-report.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const makePrisma = () => ({
  journalBatch: { findMany: jest.fn() },
  chartOfAccount: { findMany: jest.fn() },
  invoice: { findMany: jest.fn() },
});

describe('FinancialReportService', () => {
  let service: FinancialReportService;
  let prisma: ReturnType<typeof makePrisma>;
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialReportService,
        { provide: PrismaService, useFactory: makePrisma },
      ],
    }).compile();
    service = module.get(FinancialReportService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
  });

  describe('trialBalance', () => {
    it('aggregates posted entries per account and reports balanced totals', async () => {
      prisma.journalBatch.findMany.mockResolvedValue([
        {
          entries: [
            { accountCode: '131', debitAmount: '1000', creditAmount: '0' },
            { accountCode: '511', debitAmount: '0', creditAmount: '1000' },
          ],
        },
      ]);
      prisma.chartOfAccount.findMany.mockResolvedValue([
        {
          accountCode: '131',
          accountName: 'AR',
          accountType: 'asset',
          normalBalance: 'debit',
        },
        {
          accountCode: '511',
          accountName: 'Revenue',
          accountType: 'revenue',
          normalBalance: 'credit',
        },
      ]);

      const tb = await service.trialBalance(tenantId, '2026-06');
      expect(tb.totalDebits).toBe(1000);
      expect(tb.totalCredits).toBe(1000);
      expect(tb.balanced).toBe(true);
      expect(tb.accounts).toHaveLength(2);
    });
  });

  describe('incomeStatement', () => {
    it('computes gross profit and net income from revenue/COGS/expense', async () => {
      prisma.journalBatch.findMany.mockResolvedValue([
        {
          entries: [
            { accountCode: '511', debitAmount: '0', creditAmount: '10000' }, // revenue
            { accountCode: '632', debitAmount: '4000', creditAmount: '0' }, // COGS
            { accountCode: '642', debitAmount: '2000', creditAmount: '0' }, // opex
          ],
        },
      ]);
      prisma.chartOfAccount.findMany.mockResolvedValue([
        {
          accountCode: '511',
          accountName: 'Revenue',
          accountType: 'revenue',
          normalBalance: 'credit',
        },
        {
          accountCode: '632',
          accountName: 'COGS',
          accountType: 'expense',
          normalBalance: 'debit',
        },
        {
          accountCode: '642',
          accountName: 'Admin',
          accountType: 'expense',
          normalBalance: 'debit',
        },
      ]);

      const pl = await service.incomeStatement(tenantId, '2026-01', '2026-06');
      expect(pl.revenue).toBe(10000);
      expect(pl.costOfGoodsSold).toBe(4000);
      expect(pl.grossProfit).toBe(6000);
      expect(pl.totalOperatingExpenses).toBe(2000);
      expect(pl.netIncome).toBe(4000);
    });
  });

  describe('aging', () => {
    it('buckets invoice balances into 30/60/90/120+ overdue bands', async () => {
      const asOf = '2026-06-30';
      const daysAgo = (n: number) =>
        new Date(new Date(asOf).getTime() - n * 86_400_000).toISOString();
      prisma.invoice.findMany.mockResolvedValue([
        {
          invoiceNumber: 'A',
          partyId: 'p',
          grandTotal: '100',
          amountPaid: '0',
          balanceDue: '100',
          dueDate: daysAgo(-5),
          invoiceDate: daysAgo(-5),
        }, // not due
        {
          invoiceNumber: 'B',
          partyId: 'p',
          grandTotal: '200',
          amountPaid: '0',
          balanceDue: '200',
          dueDate: daysAgo(15),
          invoiceDate: daysAgo(20),
        }, // 1-30
        {
          invoiceNumber: 'C',
          partyId: 'p',
          grandTotal: '300',
          amountPaid: '0',
          balanceDue: '300',
          dueDate: daysAgo(100),
          invoiceDate: daysAgo(110),
        }, // 91-120
        {
          invoiceNumber: 'D',
          partyId: 'p',
          grandTotal: '400',
          amountPaid: '0',
          balanceDue: '400',
          dueDate: daysAgo(200),
          invoiceDate: daysAgo(210),
        }, // 120+
      ]);

      const aging = await service.aging(tenantId, 'sales', asOf);
      expect(aging.summary.notYetDue).toBe(100);
      expect(aging.summary['1-30']).toBe(200);
      expect(aging.summary['91-120']).toBe(300);
      expect(aging.summary['120+']).toBe(400);
      expect(aging.summary.total).toBe(1000);
      expect(aging.reportType).toBe('ar_aging');
    });
  });
});
