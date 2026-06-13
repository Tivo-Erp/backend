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
import { NotificationService } from '../../ntf/services/notification.service.js';
import { LEAVE_REQUEST_FIELD_CONFIG } from '../config/leave.field-config.js';
import {
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  LeaveActionDto,
  LeaveRequestQueryDto,
} from '../dto/leave.dto.js';

const REQ_SORTABLE = ['createdAt', 'startDate', 'status'] as const;
const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Leave types ───────────────────────────────────────────────

  async createLeaveType(tenantId: string, dto: CreateLeaveTypeDto) {
    try {
      return await this.prisma.leaveType.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          defaultDays: dto.defaultDays ?? 12,
          isPaid: dto.isPaid ?? true,
          requiresDoc: dto.requiresDoc ?? false,
          maxCarryOver: dto.maxCarryOver ?? 5,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('HRM_LEAVE_TYPE_CODE_EXISTS');
      }
      throw e;
    }
  }

  listLeaveTypes(tenantId: string) {
    return this.prisma.leaveType.findMany({
      where: { tenantId },
      orderBy: { code: 'asc' },
    });
  }

  // ── HRM-001: Submit leave request ─────────────────────────────

  async createRequest(tenantId: string, dto: CreateLeaveRequestDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) throw new BadRequestException('HRM_LEAVE_END_BEFORE_START');

    const halfDay = dto.halfDay ?? 'full_day';
    if (halfDay !== 'full_day' && !this.isSameDay(start, end)) {
      throw new BadRequestException('HRM_LEAVE_HALF_DAY_RANGE');
    }
    const totalDays = this.workingDays(start, end, halfDay);
    if (totalDays <= 0) throw new BadRequestException('HRM_LEAVE_ZERO_DAYS');

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { id: dto.employeeId, tenantId },
        select: { id: true, userId: true },
      });
      if (!employee) throw new NotFoundException('HRM_EMPLOYEE_NOT_FOUND');

      const leaveType = await tx.leaveType.findFirst({
        where: { id: dto.leaveTypeId, tenantId },
      });
      if (!leaveType) throw new NotFoundException('HRM_LEAVE_TYPE_NOT_FOUND');

      // The same calendar days must not be requested twice.
      const overlap = await tx.leaveRequest.findFirst({
        where: {
          tenantId,
          employeeId: dto.employeeId,
          status: { in: ['pending', 'approved'] },
          startDate: { lte: end },
          endDate: { gte: start },
        },
        select: { id: true },
      });
      if (overlap) throw new ConflictException('HRM_LEAVE_OVERLAP');

      const year = start.getUTCFullYear();
      const balance = await this.ensureBalance(
        tx,
        tenantId,
        dto.employeeId,
        leaveType,
        year,
      );

      const available = dec(balance.entitlement)
        .add(dec(balance.carryOver))
        .sub(dec(balance.used));
      if (available.lt(dec(totalDays))) {
        throw new BadRequestException(
          `HRM_LEAVE_INSUFFICIENT_BALANCE: available ${available.toString()}, requested ${totalDays}`,
        );
      }

      return tx.leaveRequest.create({
        data: {
          tenantId,
          employeeId: dto.employeeId,
          leaveTypeId: dto.leaveTypeId,
          startDate: start,
          endDate: end,
          totalDays: dec(totalDays),
          halfDay,
          reason: dto.reason ?? null,
          status: 'pending',
        },
      });
    });
  }

  // ── Approve / reject ──────────────────────────────────────────

  async approve(tenantId: string, id: string, approverId: string, _dto: LeaveActionDto) {
    const { request, notifyUserId } = await this.prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.findFirst({
        where: { id, tenantId },
      });
      if (!req) throw new NotFoundException('HRM_LEAVE_REQUEST_NOT_FOUND');
      if (req.status !== 'pending')
        throw new ConflictException('HRM_LEAVE_NOT_PENDING');

      const year = req.startDate.getUTCFullYear();
      const balance = await tx.leaveBalance.findFirst({
        where: { tenantId, employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year },
      });
      if (!balance) throw new ConflictException('HRM_LEAVE_BALANCE_MISSING');

      // Re-check availability at approval time (other requests may have used it).
      const available = dec(balance.entitlement)
        .add(dec(balance.carryOver))
        .sub(dec(balance.used));
      if (available.lt(dec(req.totalDays))) {
        throw new ConflictException('HRM_LEAVE_INSUFFICIENT_BALANCE');
      }

      // Race-safe claim: only one approver flips pending → approved.
      const claimed = await tx.leaveRequest.updateMany({
        where: { id, tenantId, status: 'pending' },
        data: { status: 'approved', approvedBy: approverId, approvedAt: new Date() },
      });
      if (claimed.count === 0)
        throw new ConflictException('HRM_LEAVE_NOT_PENDING');

      // Guarded deduction: the in-memory availability check above is advisory
      // only — a concurrent approval of ANOTHER request for the same balance
      // could overdraw it. The bound is re-evaluated inside the UPDATE.
      const deducted = await tx.$executeRaw`
        UPDATE "leave_balances"
        SET "used" = "used" + ${dec(req.totalDays)}
        WHERE "id" = ${balance.id}::uuid
          AND "used" + ${dec(req.totalDays)} <= "entitlement" + "carryOver"
      `;
      if (deducted === 0) {
        throw new ConflictException('HRM_LEAVE_INSUFFICIENT_BALANCE');
      }

      const emp = await tx.employee.findFirst({
        where: { id: req.employeeId, tenantId },
        select: { userId: true },
      });
      return {
        request: await tx.leaveRequest.findFirst({ where: { id, tenantId } }),
        notifyUserId: emp?.userId ?? null,
      };
    });

    // Notify only after the transaction committed — no phantom events.
    if (notifyUserId) await this.notifyUser(tenantId, notifyUserId, id, 'approved');
    return request;
  }

  async reject(tenantId: string, id: string, approverId: string, _dto: LeaveActionDto) {
    const { request, notifyUserId } = await this.prisma.$transaction(async (tx) => {
      const req = await tx.leaveRequest.findFirst({ where: { id, tenantId } });
      if (!req) throw new NotFoundException('HRM_LEAVE_REQUEST_NOT_FOUND');
      if (req.status !== 'pending')
        throw new ConflictException('HRM_LEAVE_NOT_PENDING');

      const claimed = await tx.leaveRequest.updateMany({
        where: { id, tenantId, status: 'pending' },
        data: { status: 'rejected', approvedBy: approverId, approvedAt: new Date() },
      });
      if (claimed.count === 0)
        throw new ConflictException('HRM_LEAVE_NOT_PENDING');

      const emp = await tx.employee.findFirst({
        where: { id: req.employeeId, tenantId },
        select: { userId: true },
      });
      return {
        request: await tx.leaveRequest.findFirst({ where: { id, tenantId } }),
        notifyUserId: emp?.userId ?? null,
      };
    });

    if (notifyUserId) await this.notifyUser(tenantId, notifyUserId, id, 'rejected');
    return request;
  }

  async findRequests(tenantId: string, query: LeaveRequestQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      LEAVE_REQUEST_FIELD_CONFIG,
    );
    const { page = 1, limit = 20, sortOrder = 'desc', employeeId, status } = query;
    const sortBy = safeSortBy(query.sortBy, REQ_SORTABLE);

    const where: Prisma.LeaveRequestWhereInput = {
      tenantId,
      ...(employeeId && { employeeId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  // ── helpers ────────────────────────────────────────────────────

  /**
   * Inclusive working-day count excluding Saturdays/Sundays. A half-day request
   * (only valid for a single day) counts as 0.5. Public holidays are not yet
   * modelled — TODO(holiday-calendar).
   */
  workingDays(start: Date, end: Date, halfDay: string): number {
    const sameDay = this.isSameDay(start, end);
    if (sameDay && halfDay !== 'full_day') {
      const dow = start.getUTCDay();
      return dow === 0 || dow === 6 ? 0 : 0.5;
    }

    let count = 0;
    const cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    );
    const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    while (cursor.getTime() <= last) {
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) count += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
  }

  private async ensureBalance(
    tx: any,
    tenantId: string,
    employeeId: string,
    leaveType: { id: string; defaultDays: number },
    year: number,
  ) {
    const existing = await tx.leaveBalance.findFirst({
      where: { tenantId, employeeId, leaveTypeId: leaveType.id, year },
    });
    if (existing) return existing;
    return tx.leaveBalance.create({
      data: {
        tenantId,
        employeeId,
        leaveTypeId: leaveType.id,
        year,
        entitlement: dec(leaveType.defaultDays),
        used: dec(0),
        carryOver: dec(0),
      },
    });
  }

  private isSameDay(start: Date, end: Date): boolean {
    return (
      start.getUTCFullYear() === end.getUTCFullYear() &&
      start.getUTCMonth() === end.getUTCMonth() &&
      start.getUTCDate() === end.getUTCDate()
    );
  }

  private async notifyUser(
    tenantId: string,
    userId: string,
    requestId: string,
    outcome: 'approved' | 'rejected',
  ) {
    await this.notifications.create(tenantId, {
      userId,
      title: `Leave request ${outcome}`,
      category: outcome === 'approved' ? 'info' : 'alert',
      entityType: 'leave_request',
      entityId: requestId,
    });
  }
}
