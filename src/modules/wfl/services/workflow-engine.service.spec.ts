import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowEngineService } from './workflow-engine.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { NotificationService } from '../../ntf/services/notification.service.js';

const makePrisma = () => ({
  userRole: { findMany: jest.fn().mockResolvedValue([]) },
  workflowInstance: { findFirst: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(),
});

const def = (steps: any[]) => ({ steps });

describe('WorkflowEngineService', () => {
  let service: WorkflowEngineService;
  let prisma: ReturnType<typeof makePrisma>;
  const notifications = { create: jest.fn() };
  const tenantId = 't1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowEngineService,
        { provide: PrismaService, useFactory: makePrisma },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = module.get(WorkflowEngineService);
    prisma = module.get(PrismaService);
    jest.clearAllMocks();
    prisma.userRole.findMany.mockResolvedValue([]);
  });

  const twoStepUserDef = def([
    {
      stepNumber: 1,
      name: 'Step1',
      stepType: 'approval',
      approverType: 'user',
      approverId: 'u1',
    },
    {
      stepNumber: 2,
      name: 'Step2',
      stepType: 'approval',
      approverType: 'user',
      approverId: 'u2',
    },
  ]);

  it('rejects approval from a user who is not the current-step approver', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wi1',
          status: 'running',
          currentStep: 1,
          requestedBy: 'r1',
          entityType: 'po',
          entityId: 'po1',
          definition: twoStepUserDef,
        }),
        updateMany: jest.fn(),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(
      service.approve(tenantId, 'wi1', 'INTRUDER', [], {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('advances to the next step when an intermediate approver approves', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'wi1',
            status: 'running',
            currentStep: 1,
            requestedBy: 'r1',
            entityType: 'po',
            entityId: 'po1',
            definition: twoStepUserDef,
          })
          .mockResolvedValueOnce({
            id: 'wi1',
            currentStep: 2,
            status: 'running',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflowAction: { create: jest.fn() },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.approve(tenantId, 'wi1', 'u1', [], { comment: 'ok' });
    expect(tx.workflowAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'approved', stepNumber: 1 }),
      }),
    );
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentStep: 2 } }),
    );
  });

  it('completes the instance when the final approver approves', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'wi1',
            status: 'running',
            currentStep: 2,
            requestedBy: 'r1',
            entityType: 'po',
            entityId: 'po1',
            definition: twoStepUserDef,
          })
          .mockResolvedValueOnce({ id: 'wi1', status: 'completed' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.approve(tenantId, 'wi1', 'u2', [], {});
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'completed' } }),
    );
    expect(notifications.create).toHaveBeenCalled();
  });

  it('rejects the whole instance on reject', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'wi1',
            status: 'running',
            currentStep: 1,
            requestedBy: 'r1',
            entityType: 'po',
            entityId: 'po1',
            definition: twoStepUserDef,
          })
          .mockResolvedValueOnce({ id: 'wi1', status: 'rejected' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.reject(tenantId, 'wi1', 'u1', [], {});
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'rejected' } }),
    );
  });

  it('refuses to act on a non-running instance', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wi1',
          status: 'completed',
          currentStep: 2,
          definition: twoStepUserDef,
        }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(
      service.approve(tenantId, 'wi1', 'u2', [], {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a stale-step reject when the instance advanced concurrently', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wi1',
          status: 'running',
          currentStep: 1,
          requestedBy: 'r1',
          entityType: 'po',
          entityId: 'po1',
          definition: twoStepUserDef,
        }),
        // claim loses: another approver moved currentStep past 1
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(
      service.reject(tenantId, 'wi1', 'u1', [], {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ currentStep: 1, status: 'running' }),
      }),
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('refuses an approve whose advance claim loses the race', async () => {
    const tx = {
      workflowInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'wi1',
          status: 'running',
          currentStep: 1,
          requestedBy: 'r1',
          entityType: 'po',
          entityId: 'po1',
          definition: twoStepUserDef,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await expect(
      service.approve(tenantId, 'wi1', 'u1', [], {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('auto-executes a notification step and advances past it', async () => {
    const mixedDef = def([
      {
        stepNumber: 1,
        name: 'Mgr',
        stepType: 'approval',
        approverType: 'user',
        approverId: 'u1',
      },
      {
        stepNumber: 2,
        name: 'FYI finance',
        stepType: 'notification',
        approverType: null,
        approverId: null,
      },
      {
        stepNumber: 3,
        name: 'Director',
        stepType: 'approval',
        approverType: 'user',
        approverId: 'u3',
      },
    ]);
    const tx = {
      workflowInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'wi1',
            status: 'running',
            currentStep: 1,
            requestedBy: 'r1',
            entityType: 'po',
            entityId: 'po1',
            definition: mixedDef,
          })
          .mockResolvedValueOnce({
            id: 'wi1',
            currentStep: 3,
            status: 'running',
          }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflowAction: { create: jest.fn() },
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.approve(tenantId, 'wi1', 'u1', [], {});
    // advanced 1→2 (notification, auto) then 2→3 (next approval)
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentStep: 2 } }),
    );
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentStep: 3 } }),
    );
    // notification-step push + step-3 approver push delivered post-commit
    expect(notifications.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ title: 'Workflow notification: FYI finance' }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ userId: 'u3', category: 'approval' }),
    );
  });

  it('completes when the trailing step after an approval is a notification', async () => {
    const trailingDef = def([
      {
        stepNumber: 1,
        name: 'Mgr',
        stepType: 'approval',
        approverType: 'user',
        approverId: 'u1',
      },
      {
        stepNumber: 2,
        name: 'FYI',
        stepType: 'notification',
        approverType: null,
        approverId: null,
      },
    ]);
    const tx = {
      workflowInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'wi1',
            status: 'running',
            currentStep: 1,
            requestedBy: 'r1',
            entityType: 'po',
            entityId: 'po1',
            definition: trailingDef,
          })
          .mockResolvedValueOnce({ id: 'wi1', status: 'completed' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    const inst: any = await service.approve(tenantId, 'wi1', 'u1', [], {});
    expect(inst.status).toBe('completed');
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'completed' } }),
    );
  });

  describe('start', () => {
    const baseDef = {
      id: 'd1',
      isActive: true,
      triggerEntity: 'purchase_order',
      steps: [
        {
          stepNumber: 1,
          name: 'Mgr',
          stepType: 'approval',
          approverType: 'user',
          approverId: 'u1',
        },
      ],
    };

    it('rejects an entityType that does not match the definition trigger', async () => {
      const tx = {
        workflowDefinition: { findFirst: jest.fn().mockResolvedValue(baseDef) },
        workflowInstance: { findFirst: jest.fn(), create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.start(tenantId, 'r1', {
          definitionId: 'd1',
          entityType: 'sales_order',
          entityId: 'e1',
        } as any),
      ).rejects.toMatchObject({ message: 'WFL_ENTITY_TYPE_MISMATCH' });
    });

    it('rejects a duplicate running instance for the same entity', async () => {
      const tx = {
        workflowDefinition: { findFirst: jest.fn().mockResolvedValue(baseDef) },
        workflowInstance: {
          findFirst: jest.fn().mockResolvedValue({ id: 'wi-existing' }),
          create: jest.fn(),
        },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(
        service.start(tenantId, 'r1', {
          definitionId: 'd1',
          entityType: 'purchase_order',
          entityId: 'e1',
        } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.workflowInstance.create).not.toHaveBeenCalled();
    });

    it('starts at step 1 and notifies the first approver post-commit', async () => {
      const tx = {
        workflowDefinition: { findFirst: jest.fn().mockResolvedValue(baseDef) },
        workflowInstance: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({
            id: 'wi1',
            currentStep: 1,
            status: 'running',
            entityType: 'purchase_order',
            entityId: 'e1',
          }),
        },
        userRole: { findMany: jest.fn().mockResolvedValue([]) },
      };
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));
      const inst: any = await service.start(tenantId, 'r1', {
        definitionId: 'd1',
        entityType: 'purchase_order',
        entityId: 'e1',
      });
      expect(inst.id).toBe('wi1');
      expect(notifications.create).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({ userId: 'u1', category: 'approval' }),
      );
    });
  });

  it('honours role-based approver eligibility via the user role set', async () => {
    prisma.userRole.findMany.mockResolvedValue([{ roleId: 'role-mgr' }]);
    const roleDef = def([
      {
        stepNumber: 1,
        name: 'Mgr',
        stepType: 'approval',
        approverType: 'role',
        approverId: 'role-mgr',
      },
    ]);
    const tx = {
      workflowInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'wi1',
            status: 'running',
            currentStep: 1,
            requestedBy: 'r1',
            entityType: 'po',
            entityId: 'po1',
            definition: roleDef,
          })
          .mockResolvedValueOnce({ id: 'wi1', status: 'completed' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      workflowAction: { create: jest.fn() },
    };
    prisma.$transaction.mockImplementation((fn: any) => fn(tx));
    await service.approve(tenantId, 'wi1', 'someUser', ['manager'], {});
    expect(tx.workflowInstance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'completed' } }),
    );
  });
});
