import { Injectable, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { AuditLogQueryDto } from '../dto/audit-log-query.dto.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { AUDIT_LOG_FIELD_CONFIG } from '../config/audit-log.field-config.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: {
    tenantId: string;
    userId?: string;
    action: string;
    module: string;
    entityType?: string;
    entityId?: string;
    changes?: Record<string, unknown> | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return this.prisma.auditLog.create({
      data: {
        ...data,
        changes: (data.changes ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(tenantId: string, query: AuditLogQueryDto, userRoles: string[] = []) {
    const where: any = { tenantId };
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if (query.userId) where.userId = query.userId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const prismaSelect = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      AUDIT_LOG_FIELD_CONFIG,
    );

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: ((query.page || 1) - 1) * (query.limit || 20),
        take: query.limit || 20,
        orderBy: { createdAt: 'desc' },
        select: prismaSelect,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return PaginatedResponseDto.create(
      data,
      total,
      query.page || 1,
      query.limit || 20,
    );
  }
}

