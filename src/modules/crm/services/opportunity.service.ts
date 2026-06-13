import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { OPPORTUNITY_FIELD_CONFIG } from '../config/crm.field-config.js';
import {
  CreateOpportunityDto,
  OpportunityQueryDto,
  UpdateOpportunityDto,
} from '../dto/crm.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const OPP_SORTABLE = ['createdAt', 'updatedAt', 'name', 'expectedRevenue', 'status'] as const;

@Injectable()
export class OpportunityService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, userId: string, dto: CreateOpportunityDto) {
    await this.requireStage(tenantId, dto.stageId);
    if (dto.customerId) await this.requireCustomer(tenantId, dto.customerId);

    return this.prisma.opportunity.create({
      data: {
        tenantId,
        name: dto.name,
        stageId: dto.stageId,
        customerId: dto.customerId ?? null,
        leadId: dto.leadId ?? null,
        expectedRevenue: dto.expectedRevenue != null ? dec(dto.expectedRevenue) : dec(0),
        currency: dto.currency ?? 'VND',
        assignedTo: dto.assignedTo ?? null,
        status: 'open',
        createdBy: userId,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateOpportunityDto) {
    const opp = await this.require(tenantId, id);

    let status = opp.status;
    let wonAt = opp.wonAt;
    if (dto.stageId) {
      const stage = await this.requireStage(tenantId, dto.stageId);
      // Win/lost are driven by the stage flags so probability stays canonical.
      if (stage.isWon) {
        status = 'won';
        wonAt = new Date();
      } else if (stage.isLost) {
        status = 'lost';
      } else {
        status = 'open';
      }
    }

    return this.prisma.opportunity.update({
      where: { id },
      data: {
        ...(dto.stageId !== undefined && { stageId: dto.stageId }),
        ...(dto.expectedRevenue !== undefined && {
          expectedRevenue: dec(dto.expectedRevenue),
        }),
        ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
        ...(dto.lostReason !== undefined && { lostReason: dto.lostReason }),
        status,
        wonAt,
      },
    });
  }

  async findAll(tenantId: string, query: OpportunityQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(query.fields, userRoles, OPPORTUNITY_FIELD_CONFIG);
    const { page = 1, limit = 20, sortOrder = 'desc', stageId, customerId, status } = query;
    const sortBy = safeSortBy(query.sortBy, OPP_SORTABLE);

    const where: Prisma.OpportunityWhereInput = {
      tenantId,
      ...(stageId && { stageId }),
      ...(customerId && { customerId }),
      ...(status && { status }),
    };

    const [data, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.opportunity.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const opp = await this.prisma.opportunity.findFirst({
      where: { id, tenantId },
      include: { stage: true },
    });
    if (!opp) throw new NotFoundException('CRM_OPPORTUNITY_NOT_FOUND');
    return opp;
  }

  private async require(tenantId: string, id: string) {
    const opp = await this.prisma.opportunity.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, wonAt: true },
    });
    if (!opp) throw new NotFoundException('CRM_OPPORTUNITY_NOT_FOUND');
    return opp;
  }

  private async requireStage(tenantId: string, stageId: string) {
    const stage = await this.prisma.pipelineStage.findFirst({
      where: { id: stageId, tenantId },
      select: { id: true, isWon: true, isLost: true },
    });
    if (!stage) throw new NotFoundException('CRM_PIPELINE_STAGE_NOT_FOUND');
    return stage;
  }

  private async requireCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');
  }
}
