import {
  BadRequestException,
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
import { QC_INSPECTION_FIELD_CONFIG } from '../config/qc.field-config.js';
import {
  CreateInspectionDto,
  InspectionQueryDto,
  SubmitResultsDto,
} from '../dto/qc.dto.js';

const INSP_SORTABLE = ['createdAt', 'updatedAt', 'inspectionNumber', 'status'] as const;
const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

@Injectable()
export class QcInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  async create(tenantId: string, dto: CreateInspectionDto) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: dto.itemId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');

      // The inspected source document must exist in this tenant.
      const source =
        dto.sourceType === 'grn'
          ? await tx.goodsReceipt.findFirst({
              where: { id: dto.sourceId, tenantId },
              select: { id: true },
            })
          : await tx.workOrder.findFirst({
              where: { id: dto.sourceId, tenantId, deletedAt: null },
              select: { id: true },
            });
      if (!source) {
        throw new NotFoundException(`QC_SOURCE_NOT_FOUND: ${dto.sourceType} ${dto.sourceId}`);
      }

      const inspectionNumber = await this.sequences.getNextNumber(
        tenantId,
        'QC',
        undefined,
        tx,
      );

      return tx.qCInspection.create({
        data: {
          tenantId,
          inspectionNumber,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          itemId: dto.itemId,
          totalQty: dec(dto.totalQty),
          status: 'pending',
        },
      });
    });
  }

  // ── Submit results → derive pass/fail/partial ─────────────────

  async submitResults(
    tenantId: string,
    inspectorId: string,
    id: string,
    dto: SubmitResultsDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const inspection = await tx.qCInspection.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true, totalQty: true },
      });
      if (!inspection) throw new NotFoundException('QC_INSPECTION_NOT_FOUND');
      if (inspection.status !== 'pending' && inspection.status !== 'in_progress') {
        throw new ConflictException('QC_INSPECTION_ALREADY_FINALIZED');
      }

      const accepted = dec(dto.acceptedQty);
      const rejected = dec(dto.rejectedQty);
      if (!accepted.add(rejected).equals(dec(inspection.totalQty))) {
        throw new BadRequestException('QC_QTY_MISMATCH'); // accepted + rejected must equal totalQty
      }

      const status = rejected.isZero()
        ? 'passed'
        : accepted.isZero()
          ? 'failed'
          : 'partial_pass';

      // Race-safe claim: only finalize from a non-finalized state.
      const claimed = await tx.qCInspection.updateMany({
        where: { id, tenantId, status: { in: ['pending', 'in_progress'] } },
        data: {
          acceptedQty: accepted,
          rejectedQty: rejected,
          status,
          inspectorId,
          inspectorNotes: dto.inspectorNotes ?? null,
        },
      });
      if (claimed.count === 0)
        throw new ConflictException('QC_INSPECTION_ALREADY_FINALIZED');

      // Replace any prior results (idempotent re-submission within open state).
      await tx.qCInspectionResult.deleteMany({ where: { inspectionId: id } });
      await tx.qCInspectionResult.createMany({
        data: dto.results.map((r) => ({
          inspectionId: id,
          criterionName: r.criterionName,
          measuredValue: r.measuredValue != null ? dec(r.measuredValue) : null,
          passed: r.passed,
          notes: r.notes ?? null,
        })),
      });

      return tx.qCInspection.findFirst({
        where: { id, tenantId },
        include: { results: true },
      });
    });
  }

  async findAll(tenantId: string, query: InspectionQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      QC_INSPECTION_FIELD_CONFIG,
    );
    const { page = 1, limit = 20, sortOrder = 'desc', status, sourceType, itemId } = query;
    const sortBy = safeSortBy(query.sortBy, INSP_SORTABLE);

    const where: Prisma.QCInspectionWhereInput = {
      tenantId,
      ...(status && { status }),
      ...(sourceType && { sourceType }),
      ...(itemId && { itemId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.qCInspection.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.qCInspection.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string, userRoles: string[], fields?: string) {
    const select = FieldSelector.buildPrismaSelect(
      fields,
      userRoles,
      QC_INSPECTION_FIELD_CONFIG,
    );
    const inspection = await this.prisma.qCInspection.findFirst({
      where: { id, tenantId },
      select: { ...select, results: true },
    });
    if (!inspection) throw new NotFoundException('QC_INSPECTION_NOT_FOUND');
    return inspection;
  }
}
