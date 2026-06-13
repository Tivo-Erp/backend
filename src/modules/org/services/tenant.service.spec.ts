import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { TenantService } from './tenant.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { TenantRepository } from '../repositories/tenant.repository.js';

const BASE_DTO = {
  name: 'Acme Corp',
  slug: 'acme-corp',
  email: 'owner@acme.com',
  password: 'Password1',
  timezone: 'Asia/Ho_Chi_Minh',
};

const mockTx = {
  tenant: { findUnique: jest.fn(), create: jest.fn() },
  user: { findFirst: jest.fn(), create: jest.fn() },
  role: { create: jest.fn() },
  permission: { findMany: jest.fn() },
  rolePermission: { createMany: jest.fn() },
  userRole: { create: jest.fn() },
  plan: { findUnique: jest.fn() },
  subscription: { create: jest.fn() },
  documentSequence: { createMany: jest.fn() },
  chartOfAccount: { createMany: jest.fn() },
  pipelineStage: { createMany: jest.fn() },
};

const mockPrisma = {
  $transaction: jest.fn((cb: (tx: typeof mockTx) => any) => cb(mockTx)),
};

const mockTenantRepo = {
  findWithSubscription: jest.fn(),
  update: jest.fn(),
};

describe('TenantService', () => {
  let service: TenantService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TenantRepository, useValue: mockTenantRepo },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);

    // Default happy-path mocks
    mockTx.tenant.findUnique.mockResolvedValue(null); // slug not taken
    mockTx.user.findFirst.mockResolvedValue(null);    // email not taken
    mockTx.tenant.create.mockResolvedValue({ id: 'tenant-1', slug: 'acme-corp', status: 'active' });
    mockTx.user.create.mockResolvedValue({ id: 'user-1' });
    mockTx.role.create
      .mockResolvedValueOnce({ id: 'role-owner' })
      .mockResolvedValue({ id: 'role-other' });
    mockTx.permission.findMany.mockResolvedValue([{ id: 'perm-1' }]);
    mockTx.rolePermission.createMany.mockResolvedValue({});
    mockTx.userRole.create.mockResolvedValue({});
    mockTx.plan.findUnique.mockResolvedValue({ id: 'plan-starter', code: 'starter' });
    mockTx.subscription.create.mockResolvedValue({});
    mockTx.documentSequence.createMany.mockResolvedValue({});
  });

  describe('register()', () => {
    it('happy path — creates tenant, user, roles, subscription, doc sequences', async () => {
      const result = await service.register(BASE_DTO);

      expect(result.tenantId).toBe('tenant-1');
      expect(result.userId).toBe('user-1');
      expect(result.slug).toBe('acme-corp');
      expect(result.status).toBe('active');
      expect(result.message).toBe('Tenant registered successfully');

      // 5 system roles created
      expect(mockTx.role.create).toHaveBeenCalledTimes(5);
      // owner role gets all permissions
      expect(mockTx.rolePermission.createMany).toHaveBeenCalledWith({
        data: [{ roleId: 'role-owner', permissionId: 'perm-1' }],
      });
      // 14 document sequences (Batch 4 added 'QC')
      expect(mockTx.documentSequence.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ tenantId: 'tenant-1' })]) }),
      );
      expect(mockTx.documentSequence.createMany.mock.calls[0][0].data).toHaveLength(17);
    });

    it('duplicate slug — throws ORG_TENANT_SLUG_TAKEN (409)', async () => {
      mockTx.tenant.findUnique.mockResolvedValue({ id: 'existing-tenant' });

      await expect(service.register(BASE_DTO)).rejects.toMatchObject({
        code: 'ORG_TENANT_SLUG_TAKEN',
        status: HttpStatus.CONFLICT,
      });
    });

    it('duplicate email — throws UAM_USER_ALREADY_EXISTS (409)', async () => {
      mockTx.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(service.register(BASE_DTO)).rejects.toMatchObject({
        code: 'UAM_USER_ALREADY_EXISTS',
        status: HttpStatus.CONFLICT,
      });
    });

    it('starter plan not found — throws SYSTEM_PLAN_NOT_FOUND (500)', async () => {
      mockTx.plan.findUnique.mockResolvedValue(null);

      await expect(service.register(BASE_DTO)).rejects.toMatchObject({
        code: 'SYSTEM_PLAN_NOT_FOUND',
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });
  });
});
