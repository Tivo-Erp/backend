import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { NCR_FIELD_CONFIG } from '../config/qc.field-config.js';
import { CreateNCRDto, NCRQueryDto, UpdateNCRDto } from '../dto/qc.dto.js';

const NCR_SORTABLE = ['createdAt', 'updatedAt', 'ncrNumber', 'status'] as const;

@Injectable()
export class NcrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateNCRDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.inspectionId) {
        const insp = await tx.qCInspection.findFirst({
          where: { id: dto.inspectionId, tenantId },
          select: { id: true },
        });
        if (!insp) throw new NotFoundException('QC_INSPECTION_NOT_FOUND');
      }

      if (dto.assignedTo) {
        const assignee = await tx.user.findFirst({
          where: { id: dto.assignedTo, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!assignee) throw new NotFoundException('UAM_USER_NOT_FOUND');
      }

      const ncrNumber = await this.sequences.getNextNumber(
        tenantId,
        'NCR',
        undefined,
        tx,
      );

      return tx.nCRReport.create({
        data: {
          tenantId,
          ncrNumber,
          inspectionId: dto.inspectionId ?? null,
          description: dto.description,
          disposition: dto.disposition,
          assignedTo: dto.assignedTo ?? null,
          status: 'open',
          createdBy: userId,
        },
      });
    });
  }

  async update(tenantId: string, id: string, dto: UpdateNCRDto) {
    const ncr = await this.prisma.nCRReport.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!ncr) throw new NotFoundException('QC_NCR_NOT_FOUND');

    if (dto.assignedTo) {
      const assignee = await this.prisma.user.findFirst({
        where: { id: dto.assignedTo, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!assignee) throw new NotFoundException('UAM_USER_NOT_FOUND');
    }

    // Closed NCRs are immutable; the guarded update also keeps the write tenant-scoped.
    const { count } = await this.prisma.nCRReport.updateMany({
      where: { id, tenantId, status: { not: 'closed' } },
      data: {
        ...(dto.disposition !== undefined && { disposition: dto.disposition }),
        ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    if (count === 0) throw new ConflictException('QC_NCR_CLOSED');

    return this.prisma.nCRReport.findFirst({ where: { id, tenantId } });
  }

  async findAll(tenantId: string, query: NCRQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      NCR_FIELD_CONFIG,
    );
    const { page = 1, limit = 20, sortOrder = 'desc', status, inspectionId } = query;
    const sortBy = safeSortBy(query.sortBy, NCR_SORTABLE);

    const where: Prisma.NCRReportWhereInput = {
      tenantId,
      ...(status && { status }),
      ...(inspectionId && { inspectionId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.nCRReport.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.nCRReport.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string, userRoles: string[], fields?: string) {
    const select = FieldSelector.buildPrismaSelect(fields, userRoles, NCR_FIELD_CONFIG);
    const ncr = await this.prisma.nCRReport.findFirst({
      where: { id, tenantId },
      select,
    });
    if (!ncr) throw new NotFoundException('QC_NCR_NOT_FOUND');
    return ncr;
  }
}
