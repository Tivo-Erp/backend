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
import { LEAD_FIELD_CONFIG } from '../config/crm.field-config.js';
import {
  ConvertLeadDto,
  CreateLeadDto,
  LeadQueryDto,
  UpdateLeadDto,
} from '../dto/crm.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const LEAD_SORTABLE = ['createdAt', 'updatedAt', 'companyName', 'status', 'score'] as const;

@Injectable()
export class LeadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateLeadDto) {
    return this.prisma.lead.create({
      data: {
        tenantId,
        companyName: dto.companyName,
        contactName: dto.contactName ?? null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        source: dto.source,
        status: 'new',
        estimatedValue: dto.estimatedValue != null ? dec(dto.estimatedValue) : null,
        assignedTo: dto.assignedTo ?? null,
        notes: dto.notes ?? null,
        createdBy: userId,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateLeadDto) {
    await this.require(tenantId, id);
    return this.prisma.lead.update({
      where: { id },
      data: {
        ...(dto.contactName !== undefined && { contactName: dto.contactName }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.score !== undefined && { score: dto.score }),
        ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
        ...(dto.lostReason !== undefined && { lostReason: dto.lostReason }),
      },
    });
  }

  /**
   * Converts a qualified lead into a SAL customer + a CRM opportunity, then
   * marks the lead `won`. Mirrors SRS_07 §1.2 conversion rules.
   */
  async convert(tenantId: string, userId: string, id: string, dto: ConvertLeadDto) {
    const createCustomer = dto.createCustomer ?? true;
    const createOpportunity = dto.createOpportunity ?? true;

    return this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({ where: { id, tenantId } });
      if (!lead) throw new NotFoundException('CRM_LEAD_NOT_FOUND');
      if (lead.status !== 'qualified') {
        throw new ConflictException('CRM_LEAD_NOT_QUALIFIED');
      }

      let customerId = lead.customerId;
      if (createCustomer && !customerId) {
        const code = await this.sequences.getNextNumber(tenantId, 'CUS', undefined, tx);
        const customer = await tx.customer.create({
          data: {
            tenantId,
            code,
            name: lead.companyName,
            contactName: lead.contactName,
            email: lead.email,
            phone: lead.phone,
          },
        });
        customerId = customer.id;
      }

      let opportunity = null;
      if (createOpportunity) {
        // Default to the first (lowest sortOrder) pipeline stage.
        const stage = await tx.pipelineStage.findFirst({
          where: { tenantId },
          orderBy: { sortOrder: 'asc' },
        });
        if (!stage) throw new ConflictException('CRM_NO_PIPELINE_STAGE');
        opportunity = await tx.opportunity.create({
          data: {
            tenantId,
            name: lead.companyName,
            customerId,
            leadId: lead.id,
            stageId: stage.id,
            expectedRevenue: lead.estimatedValue ?? dec(0),
            assignedTo: lead.assignedTo,
            status: 'open',
            createdBy: userId,
          },
        });
      }

      // Race-safe claim: only convert a still-qualified lead once.
      const claimed = await tx.lead.updateMany({
        where: { id, tenantId, status: 'qualified' },
        data: { status: 'won', customerId, convertedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('CRM_LEAD_NOT_QUALIFIED');

      return { leadId: lead.id, customerId, opportunity };
    });
  }

  async findAll(tenantId: string, query: LeadQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(query.fields, userRoles, LEAD_FIELD_CONFIG);
    const { page = 1, limit = 20, sortOrder = 'desc', status, assignedTo, search } = query;
    const sortBy = safeSortBy(query.sortBy, LEAD_SORTABLE);

    const where: Prisma.LeadWhereInput = {
      tenantId,
      ...(status && { status }),
      ...(assignedTo && { assignedTo }),
      ...(search && { companyName: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.lead.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId } });
    if (!lead) throw new NotFoundException('CRM_LEAD_NOT_FOUND');
    return lead;
  }

  private async require(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('CRM_LEAD_NOT_FOUND');
    return lead;
  }
}
