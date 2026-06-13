import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const ZERO = new Prisma.Decimal(0);

/** First/last instant of a fiscal month (UTC). */
function monthBounds(period: string) {
  const [y, m] = period.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)),
    year: y,
    month: m,
  };
}

interface PostedEntry {
  accountCode: string;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
}

@Injectable()
export class FinancialReportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All reports read ONLY posted journal entries (the authoritative ledger).
   * Drafts and reversed batches are excluded. Everything is tenant-scoped via
   * the parent batch's tenantId.
   */
  private async postedEntries(
    tenantId: string,
    range: { start: Date; end: Date },
  ): Promise<PostedEntry[]> {
    const batches = await this.prisma.journalBatch.findMany({
      where: {
        tenantId,
        status: 'posted',
        journalDate: { gte: range.start, lte: range.end },
      },
      select: {
        entries: {
          select: { accountCode: true, debitAmount: true, creditAmount: true },
        },
      },
    });
    return batches.flatMap((b) =>
      b.entries.map((e) => ({
        accountCode: e.accountCode,
        debitAmount: dec(e.debitAmount),
        creditAmount: dec(e.creditAmount),
      })),
    );
  }

  private async accountMap(tenantId: string) {
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { tenantId },
      select: {
        accountCode: true,
        accountName: true,
        accountType: true,
        normalBalance: true,
      },
    });
    return new Map(accounts.map((a) => [a.accountCode, a]));
  }

  // ── Trial Balance ─────────────────────────────────────────────

  async trialBalance(tenantId: string, period: string) {
    const { end, year, month } = monthBounds(period);
    // A trial balance shows cumulative account balances up to and including
    // the period end — not just the month's activity. Read from epoch.
    const epochStart = new Date(Date.UTC(1970, 0, 1));
    const [entries, accounts] = await Promise.all([
      this.postedEntries(tenantId, { start: epochStart, end }),
      this.accountMap(tenantId),
    ]);

    const byAccount = new Map<string, { debit: Prisma.Decimal; credit: Prisma.Decimal }>();
    for (const e of entries) {
      const agg = byAccount.get(e.accountCode) ?? { debit: ZERO, credit: ZERO };
      agg.debit = agg.debit.add(e.debitAmount);
      agg.credit = agg.credit.add(e.creditAmount);
      byAccount.set(e.accountCode, agg);
    }

    const rows = [...byAccount.entries()]
      .map(([code, agg]) => ({
        accountCode: code,
        accountName: accounts.get(code)?.accountName ?? code,
        totalDebit: agg.debit.toNumber(),
        totalCredit: agg.credit.toNumber(),
        balance: agg.debit.sub(agg.credit).toNumber(),
      }))
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    const totalDebits = rows.reduce((s, r) => s.add(r.totalDebit), ZERO);
    const totalCredits = rows.reduce((s, r) => s.add(r.totalCredit), ZERO);

    return {
      period,
      fiscalYear: year,
      fiscalMonth: month,
      accounts: rows,
      totalDebits: totalDebits.toNumber(),
      totalCredits: totalCredits.toNumber(),
      balanced: totalDebits.equals(totalCredits),
    };
  }

  // ── Income Statement (P&L) ────────────────────────────────────

  async incomeStatement(tenantId: string, from: string, to: string) {
    const start = monthBounds(from).start;
    const end = monthBounds(to).end;
    const [entries, accounts] = await Promise.all([
      this.postedEntries(tenantId, { start, end }),
      this.accountMap(tenantId),
    ]);

    // Revenue accounts net to credit; expense accounts net to debit.
    let revenue = ZERO;
    let cogs = ZERO;
    const expenseByAccount = new Map<string, Prisma.Decimal>();
    let otherExpense = ZERO;

    for (const e of entries) {
      const acc = accounts.get(e.accountCode);
      if (!acc) continue;
      if (acc.accountType === 'revenue') {
        revenue = revenue.add(e.creditAmount).sub(e.debitAmount);
      } else if (acc.accountType === 'expense') {
        const net = e.debitAmount.sub(e.creditAmount);
        if (e.accountCode === '632') {
          cogs = cogs.add(net);
        } else {
          expenseByAccount.set(
            e.accountCode,
            (expenseByAccount.get(e.accountCode) ?? ZERO).add(net),
          );
          otherExpense = otherExpense.add(net);
        }
      }
    }

    const grossProfit = revenue.sub(cogs);
    const netIncome = grossProfit.sub(otherExpense);

    const operatingExpenses = [...expenseByAccount.entries()]
      .map(([code, amt]) => ({
        account: code,
        name: accounts.get(code)?.accountName ?? code,
        amount: amt.toNumber(),
      }))
      .sort((a, b) => a.account.localeCompare(b.account));

    return {
      period: { from, to },
      revenue: revenue.toNumber(),
      costOfGoodsSold: cogs.toNumber(),
      grossProfit: grossProfit.toNumber(),
      operatingExpenses,
      totalOperatingExpenses: otherExpense.toNumber(),
      netIncome: netIncome.toNumber(),
      netMarginPct: revenue.isZero()
        ? 0
        : netIncome.div(revenue).mul(100).toDecimalPlaces(2).toNumber(),
    };
  }

  // ── Balance Sheet ─────────────────────────────────────────────

  async balanceSheet(tenantId: string, asOfDate?: string) {
    const end = asOfDate
      ? new Date(asOfDate + 'T23:59:59.999Z')
      : new Date();
    const start = new Date(Date.UTC(1970, 0, 1));
    const [entries, accounts] = await Promise.all([
      this.postedEntries(tenantId, { start, end }),
      this.accountMap(tenantId),
    ]);

    // Cumulative balance per account up to the as-of date.
    const balanceByType = { asset: ZERO, liability: ZERO, equity: ZERO };
    let revenue = ZERO;
    let expense = ZERO;
    const lines = { asset: [] as any[], liability: [] as any[], equity: [] as any[] };
    const perAccount = new Map<string, Prisma.Decimal>();

    for (const e of entries) {
      const acc = accounts.get(e.accountCode);
      if (!acc) continue;
      // Signed balance in the account's normal direction.
      const signed =
        acc.normalBalance === 'debit'
          ? e.debitAmount.sub(e.creditAmount)
          : e.creditAmount.sub(e.debitAmount);
      perAccount.set(
        e.accountCode,
        (perAccount.get(e.accountCode) ?? ZERO).add(signed),
      );
      if (acc.accountType === 'revenue') revenue = revenue.add(signed);
      if (acc.accountType === 'expense') expense = expense.add(signed);
    }

    for (const [code, bal] of perAccount) {
      const acc = accounts.get(code)!;
      const row = { account: code, name: acc.accountName, balance: bal.toNumber() };
      if (acc.accountType === 'asset') {
        balanceByType.asset = balanceByType.asset.add(bal);
        lines.asset.push(row);
      } else if (acc.accountType === 'liability') {
        balanceByType.liability = balanceByType.liability.add(bal);
        lines.liability.push(row);
      } else if (acc.accountType === 'equity') {
        balanceByType.equity = balanceByType.equity.add(bal);
        lines.equity.push(row);
      }
    }

    // Current-period net income rolls into equity (retained earnings).
    const netIncome = revenue.sub(expense);
    const totalEquity = balanceByType.equity.add(netIncome);
    const totalLiabEquity = balanceByType.liability.add(totalEquity);

    const sortLines = (a: any, b: any) => a.account.localeCompare(b.account);
    return {
      asOfDate: end.toISOString().slice(0, 10),
      assets: { lines: lines.asset.sort(sortLines), total: balanceByType.asset.toNumber() },
      liabilities: {
        lines: lines.liability.sort(sortLines),
        total: balanceByType.liability.toNumber(),
      },
      equity: {
        lines: lines.equity.sort(sortLines),
        currentPeriodIncome: netIncome.toNumber(),
        total: totalEquity.toNumber(),
      },
      totalAssets: balanceByType.asset.toNumber(),
      totalLiabilitiesAndEquity: totalLiabEquity.toNumber(),
      balanced: balanceByType.asset.equals(totalLiabEquity),
    };
  }

  // ── Cash Flow (simplified: movement of cash accounts 111/112) ─

  async cashFlow(tenantId: string, from: string, to: string) {
    const start = monthBounds(from).start;
    const end = monthBounds(to).end;
    const CASH = ['111', '112'];

    const [openingEntries, periodEntries] = await Promise.all([
      this.postedEntries(tenantId, {
        start: new Date(Date.UTC(1970, 0, 1)),
        end: new Date(start.getTime() - 1),
      }),
      this.postedEntries(tenantId, { start, end }),
    ]);

    const cashNet = (entries: PostedEntry[]) =>
      entries
        .filter((e) => CASH.includes(e.accountCode))
        .reduce((s, e) => s.add(e.debitAmount).sub(e.creditAmount), ZERO);

    const openingCash = cashNet(openingEntries);
    const netChange = cashNet(periodEntries);
    const inflows = periodEntries
      .filter((e) => CASH.includes(e.accountCode))
      .reduce((s, e) => s.add(e.debitAmount), ZERO);
    const outflows = periodEntries
      .filter((e) => CASH.includes(e.accountCode))
      .reduce((s, e) => s.add(e.creditAmount), ZERO);

    return {
      period: { from, to },
      openingCash: openingCash.toNumber(),
      totalInflows: inflows.toNumber(),
      totalOutflows: outflows.toNumber(),
      netChangeInCash: netChange.toNumber(),
      closingCash: openingCash.add(netChange).toNumber(),
    };
  }

  // ── AP / AR Aging ─────────────────────────────────────────────

  async aging(tenantId: string, type: 'purchase' | 'sales', asOfDate?: string) {
    const asOf = asOfDate ? new Date(asOfDate + 'T23:59:59.999Z') : new Date();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        invoiceType: type,
        status: { in: ['open', 'partially_paid'] },
        // Exclude invoices issued after the as-of date so historical snapshots
        // are not inflated by future-dated open invoices.
        invoiceDate: { lte: asOf },
      },
      select: {
        invoiceNumber: true,
        partyId: true,
        grandTotal: true,
        amountPaid: true,
        balanceDue: true,
        dueDate: true,
        invoiceDate: true,
      },
    });

    // Buckets per SRS_05 §3: grouped by 30 / 60 / 90 / 120+ days overdue.
    const buckets = {
      notYetDue: ZERO,
      d1_30: ZERO,
      d31_60: ZERO,
      d61_90: ZERO,
      d91_120: ZERO,
      d120_plus: ZERO,
    };
    const dayMs = 24 * 60 * 60 * 1000;

    const detail = invoices.map((inv) => {
      const balance = dec(inv.balanceDue);
      const due = inv.dueDate ?? inv.invoiceDate;
      const daysOverdue = Math.floor((asOf.getTime() - new Date(due).getTime()) / dayMs);
      let bucket: keyof typeof buckets;
      if (daysOverdue <= 0) bucket = 'notYetDue';
      else if (daysOverdue <= 30) bucket = 'd1_30';
      else if (daysOverdue <= 60) bucket = 'd31_60';
      else if (daysOverdue <= 90) bucket = 'd61_90';
      else if (daysOverdue <= 120) bucket = 'd91_120';
      else bucket = 'd120_plus';
      buckets[bucket] = buckets[bucket].add(balance);
      return {
        invoiceNumber: inv.invoiceNumber,
        partyId: inv.partyId,
        invoiceAmount: dec(inv.grandTotal).toNumber(),
        paidAmount: dec(inv.amountPaid).toNumber(),
        balanceDue: balance.toNumber(),
        daysOverdue,
        agingBucket: bucket,
      };
    });

    const total = Object.values(buckets).reduce((s, v) => s.add(v), ZERO);
    return {
      reportType: type === 'purchase' ? 'ap_aging' : 'ar_aging',
      asOfDate: asOf.toISOString().slice(0, 10),
      summary: {
        notYetDue: buckets.notYetDue.toNumber(),
        '1-30': buckets.d1_30.toNumber(),
        '31-60': buckets.d31_60.toNumber(),
        '61-90': buckets.d61_90.toNumber(),
        '91-120': buckets.d91_120.toNumber(),
        '120+': buckets.d120_plus.toNumber(),
        total: total.toNumber(),
      },
      detail,
    };
  }
}
