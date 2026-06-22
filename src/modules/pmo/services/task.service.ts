import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { TASK_FIELD_CONFIG } from '../config/pmo.field-config.js';
import { CreateTaskDto, TaskQueryDto, UpdateTaskDto } from '../dto/pmo.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const TASK_SORTABLE = [
  'createdAt',
  'updatedAt',
  'title',
  'status',
  'dueDate',
  'sortOrder',
] as const;

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, projectId: string, dto: CreateTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.requireProject(tx, tenantId, projectId);
      if (dto.parentTaskId) {
        const parent = await tx.projectTask.findFirst({
          where: { id: dto.parentTaskId, tenantId, projectId },
          select: { id: true },
        });
        if (!parent) throw new NotFoundException('PMO_PARENT_TASK_NOT_FOUND');
      }

      const status = dto.status ?? 'backlog';
      const task = await tx.projectTask.create({
        data: {
          tenantId,
          projectId,
          parentId: dto.parentTaskId ?? null,
          title: dto.title,
          description: dto.description ?? null,
          assignedTo: dto.assigneeId ?? null,
          status,
          priority: dto.priority ?? 'medium',
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          estimatedHours:
            dto.estimatedHours != null ? dec(dto.estimatedHours) : null,
          ...(status === 'done' && { completedAt: new Date() }),
        },
      });
      await this.recomputeProgress(tx, tenantId, projectId);
      return task;
    });
  }

  async update(
    tenantId: string,
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.projectTask.findFirst({
        where: { id: taskId, tenantId, projectId },
        select: { id: true, status: true },
      });
      if (!task) throw new NotFoundException('PMO_TASK_NOT_FOUND');

      const completing = dto.status === 'done' && task.status !== 'done';
      const reopening =
        dto.status && dto.status !== 'done' && task.status === 'done';

      const updated = await tx.projectTask.update({
        where: { id: taskId },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.priority !== undefined && { priority: dto.priority }),
          ...(dto.assigneeId !== undefined && { assignedTo: dto.assigneeId }),
          ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
          ...(dto.estimatedHours !== undefined && {
            estimatedHours: dec(dto.estimatedHours),
          }),
          ...(dto.actualHours !== undefined && {
            actualHours: dec(dto.actualHours),
          }),
          ...(completing && { completedAt: new Date() }),
          ...(reopening && { completedAt: null }),
        },
      });
      if (dto.status !== undefined)
        await this.recomputeProgress(tx, tenantId, projectId);
      return updated;
    });
  }

  async findAll(
    tenantId: string,
    projectId: string,
    query: TaskQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      TASK_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'asc',
      status,
      assigneeId,
    } = query;
    const sortBy = safeSortBy(query.sortBy, TASK_SORTABLE, 'sortOrder');

    const where: Prisma.ProjectTaskWhereInput = {
      tenantId,
      projectId,
      ...(status && { status }),
      ...(assigneeId && { assignedTo: assigneeId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.projectTask.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.projectTask.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  /** progressPct = done top-level tasks / total top-level tasks × 100. */
  private async recomputeProgress(
    tx: Prisma.TransactionClient,
    tenantId: string,
    projectId: string,
  ) {
    // Count only top-level tasks (parentId=null) so sub-tasks don't inflate
    // or deflate the percentage relative to milestone-level progress.
    const [total, done] = await Promise.all([
      tx.projectTask.count({ where: { tenantId, projectId, parentId: null } }),
      tx.projectTask.count({
        where: { tenantId, projectId, parentId: null, status: 'done' },
      }),
    ]);
    const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);
    await tx.project.updateMany({
      where: { id: projectId, tenantId },
      data: { progressPct },
    });
  }

  private async requireProject(
    tx: Prisma.TransactionClient,
    tenantId: string,
    projectId: string,
  ) {
    const project = await tx.project.findFirst({
      where: { id: projectId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('PMO_PROJECT_NOT_FOUND');
    return project;
  }
}
