import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { TIMESHEET_FIELD_CONFIG } from '../config/pmo.field-config.js';
import {
  ApproveTimesheetDto,
  CreateTimesheetDto,
  TimesheetQueryDto,
} from '../dto/pmo.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const TS_SORTABLE = ['createdAt', 'logDate', 'status'] as const;
const DAILY_LIMIT = 24;

@Injectable()
export class TimesheetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Logs time for the calling user's employee record (status: draft). */
  async create(tenantId: string, userId: string, dto: CreateTimesheetDto) {
    const logDate = new Date(dto.workDate);
    // Reject future dates (compare date-only, UTC).
    const today = new Date();
    const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (dayOf(logDate) > dayOf(today)) {
      throw new BadRequestException('PMO_TIMESHEET_FUTURE_DATE');
    }

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { tenantId, userId },
        select: { id: true },
      });
      if (!employee) throw new NotFoundException('HRM_EMPLOYEE_NOT_FOUND');

      const project = await tx.project.findFirst({
        where: { id: dto.projectId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('PMO_PROJECT_NOT_FOUND');

      if (dto.taskId) {
        const task = await tx.projectTask.findFirst({
          where: { id: dto.taskId, tenantId, projectId: dto.projectId },
          select: { id: true },
        });
        if (!task) throw new NotFoundException('PMO_TASK_NOT_FOUND');
      }

      // Serialize concurrent inserts for the same employee+day via a
      // transaction-scoped advisory lock so the daily cap cannot be bypassed
      // by two requests racing through the findMany-then-create gap.
      const lockKey = `ts:${tenantId}:${employee.id}:${dto.workDate}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

      // Max 24h per day across all projects for this employee.
      const sameDay = await tx.timesheet.findMany({
        where: { tenantId, employeeId: employee.id, logDate },
        select: { hours: true },
      });
      const existing = sameDay.reduce((s, t) => s.add(dec(t.hours)), new Prisma.Decimal(0));
      if (existing.add(dec(dto.hours)).gt(DAILY_LIMIT)) {
        throw new BadRequestException('PMO_TIMESHEET_DAILY_LIMIT');
      }

      return tx.timesheet.create({
        data: {
          tenantId,
          employeeId: employee.id,
          projectId: dto.projectId,
          taskId: dto.taskId ?? null,
          logDate,
          hours: dec(dto.hours),
          description: dto.description ?? null,
          billable: dto.isBillable ?? true,
          status: 'draft',
        },
      });
    });
  }

  async approve(tenantId: string, id: string, approverId: string, dto: ApproveTimesheetDto) {
    const ts = await this.prisma.timesheet.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true },
    });
    if (!ts) throw new NotFoundException('PMO_TIMESHEET_NOT_FOUND');
    if (ts.status === 'approved' || ts.status === 'rejected') {
      throw new ConflictException('PMO_TIMESHEET_ALREADY_DECIDED');
    }

    // Race-safe claim from a non-terminal state.
    const { count } = await this.prisma.timesheet.updateMany({
      where: { id, tenantId, status: { in: ['draft', 'submitted'] } },
      data: {
        status: dto.approved ? 'approved' : 'rejected',
        approvedBy: approverId,
        approvedAt: new Date(),
      },
    });
    if (count === 0) throw new ConflictException('PMO_TIMESHEET_ALREADY_DECIDED');
    return this.prisma.timesheet.findFirst({ where: { id, tenantId } });
  }

  async findAll(tenantId: string, query: TimesheetQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(query.fields, userRoles, TIMESHEET_FIELD_CONFIG);
    const { page = 1, limit = 20, sortOrder = 'desc', projectId, employeeId, status } = query;
    const sortBy = safeSortBy(query.sortBy, TS_SORTABLE, 'logDate');

    const where: Prisma.TimesheetWhereInput = {
      tenantId,
      ...(projectId && { projectId }),
      ...(employeeId && { employeeId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.timesheet.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.timesheet.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }
}
