import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { JournalBatchService } from '../../fin/services/journal-batch.service.js';
import { calcPayroll } from './payroll-calc.js';
import { CalculatePayrollDto, PayrollQueryDto } from '../dto/payroll.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

/** Payroll → GL account mapping (VN TT200). */
const ACC = {
  expense: '642', // salary + employer contributions expense
  payable: '334', // net payable to employees
  bhxh: '3383',
  bhyt: '3384',
  bhtn: '3386',
  pit: '3335',
} as const;

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: JournalBatchService,
  ) {}

  // ── HRM-002: Calculate a payroll run ──────────────────────────

  async calculate(tenantId: string, userId: string, dto: CalculatePayrollDto) {
    const overrides = new Map((dto.items ?? []).map((i) => [i.employeeId, i]));

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.payrollRun.findFirst({
        where: { tenantId, year: dto.year, month: dto.month },
        select: { id: true },
      });
      if (existing) throw new ConflictException('HRM_PAYROLL_RUN_EXISTS');

      // Target set: explicit items, else all non-terminated employees.
      let employees: Array<{
        id: string;
        basicSalary: Prisma.Decimal;
        numberOfDependents: number;
      }>;
      if (dto.items && dto.items.length > 0) {
        const ids = dto.items.map((i) => i.employeeId);
        employees = await tx.employee.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, basicSalary: true, numberOfDependents: true },
        });
        if (employees.length !== new Set(ids).size) {
          throw new NotFoundException('HRM_EMPLOYEE_NOT_FOUND');
        }
      } else {
        employees = await tx.employee.findMany({
          where: { tenantId, status: { not: 'terminated' } },
          select: { id: true, basicSalary: true, numberOfDependents: true },
        });
      }
      if (employees.length === 0) {
        throw new BadRequestException('HRM_PAYROLL_NO_EMPLOYEES');
      }

      const lines = employees.map((emp) => {
        const o = overrides.get(emp.id);
        const r = calcPayroll({
          basicSalary: emp.basicSalary,
          allowances: o?.allowances,
          overtime: o?.overtime,
          bonuses: o?.bonuses,
          numberOfDependents: emp.numberOfDependents,
        });
        return { employeeId: emp.id, ...r };
      });

      const sum = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) =>
        lines.reduce((s, l) => s.add(pick(l)), dec(0)).toDecimalPlaces(2);

      const totalGross = sum((l) => l.grossSalary);
      const totalNet = sum((l) => l.netSalary);
      const totalPIT = sum((l) => l.pitAmount);
      const totalInsEmp = sum((l) => l.empBHXH.add(l.empBHYT).add(l.empBHTN));
      const totalInsEmpl = sum((l) =>
        l.emplrBHXH.add(l.emplrBHYT).add(l.emplrBHTN),
      );

      try {
        return await tx.payrollRun.create({
          data: {
            tenantId,
            month: dto.month,
            year: dto.year,
            status: 'draft',
            totalGross,
            totalNet,
            totalPIT,
            totalInsEmp,
            totalInsEmpl,
            employeeCount: lines.length,
            createdBy: userId,
            lines: {
              create: lines.map((l) => ({
                employeeId: l.employeeId,
                basicSalary: l.basicSalary,
                allowances: l.allowances,
                overtime: l.overtime,
                bonuses: l.bonuses,
                grossSalary: l.grossSalary,
                empBHXH: l.empBHXH,
                empBHYT: l.empBHYT,
                empBHTN: l.empBHTN,
                personalDeduction: l.personalDeduction,
                dependentDeduction: l.dependentDeduction,
                taxableIncome: l.taxableIncome,
                pitAmount: l.pitAmount,
                netSalary: l.netSalary,
                emplrBHXH: l.emplrBHXH,
                emplrBHYT: l.emplrBHYT,
                emplrBHTN: l.emplrBHTN,
                totalCostToCompany: l.totalCostToCompany,
              })),
            },
          },
          include: { lines: true },
        });
      } catch (e) {
        // Concurrent calculate for the same period: @@unique([tenantId, year, month])
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException('HRM_PAYROLL_RUN_EXISTS');
        }
        throw e;
      }
    });
  }

  // ── HRM-002: Approve → auto-create posted journal batch ───────

  async approve(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { id, tenantId } });
      if (!run) throw new NotFoundException('HRM_PAYROLL_RUN_NOT_FOUND');
      if (run.status !== 'draft')
        throw new ConflictException('HRM_PAYROLL_NOT_DRAFT');

      // Insurance is recorded per type (employee + employer share together).
      const lines = await tx.payrollLine.findMany({
        where: { payrollRunId: id },
        select: {
          empBHXH: true,
          empBHYT: true,
          empBHTN: true,
          emplrBHXH: true,
          emplrBHYT: true,
          emplrBHTN: true,
        },
      });
      const sum = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) =>
        lines.reduce((s, l) => s.add(dec(pick(l))), dec(0)).toDecimalPlaces(2);
      const bhxh = sum((l) => dec(l.empBHXH).add(l.emplrBHXH));
      const bhyt = sum((l) => dec(l.empBHYT).add(l.emplrBHYT));
      const bhtn = sum((l) => dec(l.empBHTN).add(l.emplrBHTN));

      const expense = dec(run.totalGross).add(run.totalInsEmpl);
      const journalDate = new Date(Date.UTC(run.year, run.month - 1, 28));

      const zero = dec(0);
      const entries = [
        {
          accountCode: ACC.expense,
          description: 'Payroll expense',
          debitAmount: expense,
          creditAmount: zero,
        },
        {
          accountCode: ACC.payable,
          description: 'Net wages payable',
          debitAmount: zero,
          creditAmount: dec(run.totalNet),
        },
        {
          accountCode: ACC.bhxh,
          description: 'Social insurance payable',
          debitAmount: zero,
          creditAmount: bhxh,
        },
        {
          accountCode: ACC.bhyt,
          description: 'Health insurance payable',
          debitAmount: zero,
          creditAmount: bhyt,
        },
        {
          accountCode: ACC.bhtn,
          description: 'Unemployment insurance payable',
          debitAmount: zero,
          creditAmount: bhtn,
        },
        {
          accountCode: ACC.pit,
          description: 'PIT payable',
          debitAmount: zero,
          creditAmount: dec(run.totalPIT),
        },
      ].filter((e) => e.debitAmount.gt(0) || e.creditAmount.gt(0));

      const batch = await this.journals.createPosted(tx, tenantId, userId, {
        description: `Payroll ${run.month}/${run.year}`,
        journalDate,
        sourceType: 'payroll',
        sourceId: run.id,
        entries,
      });

      // Race-safe claim: only one approval flips draft → approved.
      const claimed = await tx.payrollRun.updateMany({
        where: { id, tenantId, status: 'draft' },
        data: { status: 'approved', journalBatchId: batch.id },
      });
      if (claimed.count === 0)
        throw new ConflictException('HRM_PAYROLL_NOT_DRAFT');

      return tx.payrollRun.findFirst({ where: { id, tenantId } });
    });
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(tenantId: string, query: PayrollQueryDto) {
    const { page = 1, limit = 20, year } = query;
    const where: Prisma.PayrollRunWhereInput = {
      tenantId,
      ...(year && { year }),
    };
    const [data, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!run) throw new NotFoundException('HRM_PAYROLL_RUN_NOT_FOUND');
    return run;
  }
}
