import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { PROJECT_FIELD_CONFIG } from '../config/pmo.field-config.js';
import {
  CreateMilestoneDto,
  CreateProjectDto,
  ProjectQueryDto,
  UpdateProjectDto,
} from '../dto/pmo.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const PROJECT_SORTABLE = ['createdAt', 'updatedAt', 'code', 'name', 'status', 'startDate'] as const;

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateProjectDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: dto.customerId, tenantId },
          select: { id: true },
        });
        if (!customer) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');
      }

      const code = await this.sequences.getNextNumber(tenantId, 'PRJ', undefined, tx);

      // De-dup members and always include the manager as a member.
      const memberIds = new Set(dto.memberIds ?? []);
      if (dto.managerId) memberIds.add(dto.managerId);

      return tx.project.create({
        data: {
          tenantId,
          code,
          name: dto.name,
          description: dto.description ?? null,
          customerId: dto.customerId ?? null,
          managerId: dto.managerId ?? null,
          status: 'planning',
          startDate: new Date(dto.startDate),
          targetEndDate: dto.endDate ? new Date(dto.endDate) : null,
          budget: dto.budget != null ? dec(dto.budget) : dec(0),
          createdBy: userId,
          members: {
            create: [...memberIds].map((uid) => ({
              userId: uid,
              role: uid === dto.managerId ? 'manager' : 'member',
            })),
          },
        },
        include: { members: true },
      });
    });
  }

  async update(tenantId: string, id: string, dto: UpdateProjectDto) {
    await this.require(tenantId, id);
    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && {
          status: dto.status,
          ...(dto.status === 'completed' && { actualEndDate: new Date() }),
        }),
        ...(dto.budget !== undefined && { budget: dec(dto.budget) }),
        ...(dto.progressPct !== undefined && { progressPct: dto.progressPct }),
        ...(dto.managerId !== undefined && { managerId: dto.managerId }),
      },
    });
  }

  async findAll(tenantId: string, query: ProjectQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(query.fields, userRoles, PROJECT_FIELD_CONFIG);
    const { page = 1, limit = 20, sortOrder = 'desc', status, customerId, search } = query;
    const sortBy = safeSortBy(query.sortBy, PROJECT_SORTABLE);

    const where: Prisma.ProjectWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status && { status }),
      ...(customerId && { customerId }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.project.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { members: true, milestones: { orderBy: { dueDate: 'asc' } } },
    });
    if (!project) throw new NotFoundException('PMO_PROJECT_NOT_FOUND');
    return project;
  }

  // ── Milestones ────────────────────────────────────────────────

  async addMilestone(tenantId: string, projectId: string, dto: CreateMilestoneDto) {
    await this.require(tenantId, projectId);
    return this.prisma.milestone.create({
      data: {
        tenantId,
        projectId,
        name: dto.name,
        dueDate: new Date(dto.dueDate),
      },
    });
  }

  async listMilestones(tenantId: string, projectId: string) {
    await this.require(tenantId, projectId);
    return this.prisma.milestone.findMany({
      where: { tenantId, projectId },
      orderBy: { dueDate: 'asc' },
    });
  }

  private async require(tenantId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('PMO_PROJECT_NOT_FOUND');
    return project;
  }
}
