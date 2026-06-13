import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { NotificationService } from '../../ntf/services/notification.service.js';
import {
  StartWorkflowDto,
  WorkflowActionDto,
  WorkflowTaskQueryDto,
} from '../dto/workflow.dto.js';

type StepRow = {
  stepNumber: number;
  name: string;
  stepType: string;
  approverType: string | null;
  approverId: string | null;
};

type NotifyPayload = {
  userId: string;
  title: string;
  body?: string;
  category: string;
  entityType: string;
  entityId: string;
  actionUrl?: string;
};

@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Start an instance ─────────────────────────────────────────

  async start(tenantId: string, userId: string, dto: StartWorkflowDto) {
    const { instance, payloads } = await this.prisma.$transaction(async (tx) => {
      const def = await tx.workflowDefinition.findFirst({
        where: { id: dto.definitionId, tenantId },
        include: { steps: { orderBy: { stepNumber: 'asc' } } },
      });
      if (!def) throw new NotFoundException('WFL_DEFINITION_NOT_FOUND');
      if (!def.isActive) throw new ConflictException('WFL_DEFINITION_INACTIVE');
      if (def.steps.length === 0)
        throw new BadRequestException('WFL_DEFINITION_NO_STEPS');
      if (dto.entityType !== def.triggerEntity) {
        throw new BadRequestException('WFL_ENTITY_TYPE_MISMATCH');
      }

      // One running approval chain per entity per definition.
      const running = await tx.workflowInstance.findFirst({
        where: {
          tenantId,
          definitionId: def.id,
          entityId: dto.entityId,
          status: 'running',
        },
        select: { id: true },
      });
      if (running) throw new ConflictException('WFL_INSTANCE_ALREADY_RUNNING');

      const created = await tx.workflowInstance.create({
        data: {
          tenantId,
          definitionId: def.id,
          entityType: dto.entityType,
          entityId: dto.entityId,
          currentStep: 1,
          status: 'running',
          requestedBy: userId,
        },
      });

      const pending = await this.collectStepApproverNotifications(
        tx,
        created,
        def.steps,
        1,
      );
      return { instance: created, payloads: pending };
    });

    // Deliver only after the transaction committed — no phantom tasks.
    await this.deliver(tenantId, payloads);
    return instance;
  }

  // ── My pending approval tasks ─────────────────────────────────

  async listTasks(
    tenantId: string,
    userId: string,
    roles: string[],
    query: WorkflowTaskQueryDto,
  ) {
    const { page = 1, limit = 20, status = 'running' } = query;

    const myRoleIds = await this.myRoleIds(userId);

    // Pull candidate instances with their definition's steps, then filter to
    // the ones whose CURRENT step names this user as an eligible approver.
    const candidates = await this.prisma.workflowInstance.findMany({
      where: { tenantId, status },
      include: {
        definition: {
          select: {
            name: true,
            steps: {
              orderBy: { stepNumber: 'asc' },
              select: {
                stepNumber: true,
                name: true,
                stepType: true,
                approverType: true,
                approverId: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const tasks = candidates
      .filter((inst) => {
        const step = inst.definition.steps.find(
          (s) => s.stepNumber === inst.currentStep,
        );
        return step ? this.isEligible(step, userId, myRoleIds) : false;
      })
      .map((inst) => {
        const step = inst.definition.steps.find(
          (s) => s.stepNumber === inst.currentStep,
        )!;
        return {
          instanceId: inst.id,
          definitionName: inst.definition.name,
          entityType: inst.entityType,
          entityId: inst.entityId,
          currentStep: inst.currentStep,
          stepName: step.name,
          requestedBy: inst.requestedBy,
          createdAt: inst.createdAt,
        };
      });

    const total = tasks.length;
    const paged = tasks.slice((page - 1) * limit, page * limit);
    return PaginatedResponseDto.create(paged, total, page, limit);
  }

  // ── Approve / reject ──────────────────────────────────────────

  async approve(
    tenantId: string,
    instanceId: string,
    userId: string,
    roles: string[],
    dto: WorkflowActionDto,
  ) {
    return this.act(tenantId, instanceId, userId, roles, 'approved', dto);
  }

  async reject(
    tenantId: string,
    instanceId: string,
    userId: string,
    roles: string[],
    dto: WorkflowActionDto,
  ) {
    return this.act(tenantId, instanceId, userId, roles, 'rejected', dto);
  }

  private async act(
    tenantId: string,
    instanceId: string,
    userId: string,
    roles: string[],
    action: 'approved' | 'rejected',
    dto: WorkflowActionDto,
  ) {
    const myRoleIds = await this.myRoleIds(userId);

    const { instance, payloads } = await this.prisma.$transaction(async (tx) => {
      const pending: NotifyPayload[] = [];
      const inst = await tx.workflowInstance.findFirst({
        where: { id: instanceId, tenantId },
        include: {
          definition: { include: { steps: { orderBy: { stepNumber: 'asc' } } } },
        },
      });
      if (!inst) throw new NotFoundException('WFL_INSTANCE_NOT_FOUND');
      if (inst.status !== 'running')
        throw new ConflictException('WFL_INSTANCE_NOT_RUNNING');

      const step = inst.definition.steps.find(
        (s) => s.stepNumber === inst.currentStep,
      );
      if (!step) throw new ConflictException('WFL_STEP_MISSING');
      if (!this.isEligible(step, userId, myRoleIds)) {
        throw new ForbiddenException('WFL_NOT_AN_APPROVER');
      }

      // Record the action against the step we observed.
      await tx.workflowAction.create({
        data: {
          instanceId: inst.id,
          stepNumber: inst.currentStep,
          action,
          actorId: userId,
          comment: dto.comment ?? null,
        },
      });

      if (action === 'rejected') {
        // Race-safe claim — pinning currentStep refuses a stale-step reject
        // when another approver advanced the instance meanwhile.
        const claimed = await tx.workflowInstance.updateMany({
          where: {
            id: inst.id,
            tenantId,
            status: 'running',
            currentStep: inst.currentStep,
          },
          data: { status: 'rejected' },
        });
        if (claimed.count === 0)
          throw new ConflictException('WFL_INSTANCE_ADVANCED');
        pending.push(
          this.requesterNotification(
            inst,
            `Request rejected at step ${inst.currentStep}`,
            'alert',
          ),
        );
        return {
          instance: await tx.workflowInstance.findFirst({ where: { id: inst.id } }),
          payloads: pending,
        };
      }

      const steps = inst.definition.steps;
      const maxStep = steps.length;
      let current = inst.currentStep;

      // Advance step by step; `notification` steps execute (queue their push)
      // and auto-advance so the instance never parks on a non-approval step.
      // `condition`/`action` step types are not accepted yet — TODO(ADR-008).
      for (;;) {
        if (current >= maxStep) {
          const claimed = await tx.workflowInstance.updateMany({
            where: { id: inst.id, tenantId, status: 'running', currentStep: current },
            data: { status: 'completed' },
          });
          if (claimed.count === 0)
            throw new ConflictException('WFL_INSTANCE_ADVANCED');
          pending.push(
            this.requesterNotification(inst, 'Request fully approved', 'info'),
          );
          break;
        }

        const next = current + 1;
        const claimed = await tx.workflowInstance.updateMany({
          where: { id: inst.id, tenantId, status: 'running', currentStep: current },
          data: { currentStep: next },
        });
        if (claimed.count === 0)
          throw new ConflictException('WFL_INSTANCE_ADVANCED');

        const nextStep = steps.find((s) => s.stepNumber === next)!;
        if (nextStep.stepType === 'notification') {
          pending.push(
            this.requesterNotification(
              inst,
              `Workflow notification: ${nextStep.name}`,
              'info',
            ),
          );
          current = next;
          continue;
        }

        pending.push(
          ...(await this.collectStepApproverNotifications(tx, inst, steps, next)),
        );
        break;
      }

      return {
        instance: await tx.workflowInstance.findFirst({ where: { id: inst.id } }),
        payloads: pending,
      };
    });

    // Deliver only after the transaction committed — no phantom tasks.
    await this.deliver(tenantId, payloads);
    return instance;
  }

  // ── helpers ────────────────────────────────────────────────────

  private isEligible(
    step: StepRow,
    userId: string,
    myRoleIds: Set<string>,
  ): boolean {
    if (step.stepType !== 'approval') return false;
    switch (step.approverType) {
      case 'user':
        return step.approverId === userId;
      case 'role':
        return step.approverId != null && myRoleIds.has(step.approverId);
      case 'manager':
      case 'department_head':
        // No org hierarchy yet — any holder of wfl:task:action (enforced by
        // RbacGuard at the controller) may act. TODO(org-hierarchy).
        return true;
      default:
        return false;
    }
  }

  private async myRoleIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      select: { roleId: true },
    });
    return new Set(rows.map((r) => r.roleId));
  }

  /** Builds (does NOT send) the approver notifications for a step. */
  private async collectStepApproverNotifications(
    tx: { userRole: any },
    instance: { id: string; entityType: string; entityId: string },
    steps: StepRow[],
    stepNumber: number,
  ): Promise<NotifyPayload[]> {
    const step = steps.find((s) => s.stepNumber === stepNumber);
    if (!step || step.stepType !== 'approval') return [];

    const targets = new Set<string>();
    if (step.approverType === 'user' && step.approverId) {
      targets.add(step.approverId);
    } else if (step.approverType === 'role' && step.approverId) {
      const holders = await tx.userRole.findMany({
        where: { roleId: step.approverId },
        select: { userId: true },
      });
      holders.forEach((h: { userId: string }) => targets.add(h.userId));
    }
    // manager/department_head: no addressable user list yet — skip push.

    return [...targets].map((userId) => ({
      userId,
      title: `Approval required: ${step.name}`,
      body: `${instance.entityType} ${instance.entityId} awaits your approval.`,
      category: 'approval',
      entityType: 'workflow_instance',
      entityId: instance.id,
      actionUrl: `/wfl/tasks/${instance.id}`,
    }));
  }

  private requesterNotification(
    instance: { id: string; requestedBy: string; entityType: string; entityId: string },
    title: string,
    category: 'info' | 'alert',
  ): NotifyPayload {
    return {
      userId: instance.requestedBy,
      title,
      body: `${instance.entityType} ${instance.entityId}`,
      category,
      entityType: 'workflow_instance',
      entityId: instance.id,
    };
  }

  /** Sends collected notifications AFTER the workflow transaction committed. */
  private async deliver(tenantId: string, payloads: NotifyPayload[]) {
    for (const p of payloads) {
      await this.notifications.create(tenantId, p);
    }
  }
}
