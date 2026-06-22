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
import { WORKFLOW_DEFINITION_FIELD_CONFIG } from '../config/workflow.field-config.js';
import {
  CreateWorkflowDefinitionDto,
  CreateWorkflowStepDto,
  UpdateWorkflowDefinitionDto,
  WorkflowDefinitionQueryDto,
} from '../dto/workflow.dto.js';

const DEF_SORTABLE = [
  'name',
  'triggerEntity',
  'createdAt',
  'updatedAt',
] as const;

@Injectable()
export class WorkflowDefinitionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateWorkflowDefinitionDto) {
    this.assertSteps(dto.steps);
    try {
      return await this.prisma.workflowDefinition.create({
        data: {
          tenantId,
          name: dto.name,
          triggerEntity: dto.triggerEntity,
          triggerEvent: dto.triggerEvent,
          triggerCondition: this.toJson(dto.triggerCondition),
          steps: { create: dto.steps.map((s) => this.toStepCreate(s)) },
        },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
    } catch (e) {
      this.rethrowStepConflict(e);
    }
  }

  async update(tenantId: string, id: string, dto: UpdateWorkflowDefinitionDto) {
    return this.prisma.$transaction(async (tx) => {
      const def = await tx.workflowDefinition.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!def) throw new NotFoundException('WFL_DEFINITION_NOT_FOUND');

      if (dto.steps) this.assertSteps(dto.steps);

      const data: Prisma.WorkflowDefinitionUpdateInput = {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.triggerCondition !== undefined && {
          triggerCondition: this.toJson(dto.triggerCondition),
        }),
      };

      if (dto.steps) {
        // Replacing steps under a running instance would orphan its current
        // step (or silently swap approvers mid-flight).
        const running = await tx.workflowInstance.count({
          where: { definitionId: id, tenantId, status: 'running' },
        });
        if (running > 0) throw new ConflictException('WFL_DEFINITION_IN_USE');

        await tx.workflowStep.deleteMany({ where: { definitionId: id } });
        data.steps = { create: dto.steps.map((s) => this.toStepCreate(s)) };
      }

      try {
        return await tx.workflowDefinition.update({
          where: { id },
          data,
          include: { steps: { orderBy: { stepNumber: 'asc' } } },
        });
      } catch (e) {
        this.rethrowStepConflict(e);
      }
    });
  }

  async findAll(
    tenantId: string,
    query: WorkflowDefinitionQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      WORKFLOW_DEFINITION_FIELD_CONFIG,
    );
    const { page = 1, limit = 20, sortOrder = 'desc', triggerEntity } = query;
    const sortBy = safeSortBy(query.sortBy, DEF_SORTABLE);
    const where = { tenantId, ...(triggerEntity && { triggerEntity }) };

    const [data, total] = await Promise.all([
      this.prisma.workflowDefinition.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.workflowDefinition.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string) {
    const def = await this.prisma.workflowDefinition.findFirst({
      where: { id, tenantId },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    });
    if (!def) throw new NotFoundException('WFL_DEFINITION_NOT_FOUND');
    return def;
  }

  // ── helpers ────────────────────────────────────────────────────

  /** Steps must be contiguous from 1, and approval steps must name an approver. */
  private assertSteps(steps: CreateWorkflowStepDto[]) {
    const numbers = steps.map((s) => s.stepNumber).sort((a, b) => a - b);
    if (new Set(numbers).size !== numbers.length) {
      throw new BadRequestException('WFL_STEP_NUMBERS_DUPLICATE');
    }
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i] !== i + 1) {
        throw new BadRequestException('WFL_STEP_NUMBERS_NOT_CONTIGUOUS');
      }
    }
    for (const s of steps) {
      if (s.stepType === 'approval') {
        if (!s.approverType) {
          throw new BadRequestException(
            `WFL_STEP_APPROVER_TYPE_REQUIRED: step ${s.stepNumber}`,
          );
        }
        if (
          (s.approverType === 'user' || s.approverType === 'role') &&
          !s.approverId
        ) {
          throw new BadRequestException(
            `WFL_STEP_APPROVER_ID_REQUIRED: step ${s.stepNumber}`,
          );
        }
      }
    }
  }

  private toStepCreate(s: CreateWorkflowStepDto) {
    return {
      stepNumber: s.stepNumber,
      name: s.name,
      stepType: s.stepType,
      approverType: s.approverType ?? null,
      approverId: s.approverId ?? null,
      timeoutHours: s.timeoutHours ?? null,
      escalationTo: s.escalationTo ?? null,
      config: this.toJson(s.config),
    };
  }

  private toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return v === undefined || v === null ? Prisma.JsonNull : v;
  }

  private rethrowStepConflict(e: unknown): never {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      throw new ConflictException('WFL_STEP_NUMBER_CONFLICT');
    }
    throw e;
  }
}
