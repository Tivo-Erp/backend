import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { UserService } from './user.service.js';
import { PrismaService } from '../../../infra/database/prisma.service.js';

const TENANT_ID = 'tenant-uuid-1';

const mockUser = (overrides = {}) => ({
  id: 'user-uuid-1',
  tenantId: TENANT_ID,
  email: 'staff@acme.com',
  firstName: 'Jane',
  lastName: 'Smith',
  status: 'active',
  deletedAt: null,
  userRoles: [],
  ...overrides,
});

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  role: {
    findMany: jest.fn(),
  },
  userRole: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  subscription: {
    findFirst: jest.fn(),
  },
  refreshToken: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(async (cb: any) => {
    const tx = {
      userRole: { deleteMany: mockPrisma.userRole.deleteMany, createMany: mockPrisma.userRole.createMany },
      user: { update: mockPrisma.user.update },
    };
    return cb(tx);
  }),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  // ─── invite ──────────────────────────────────────────────────────────────────

  describe('invite()', () => {
    const dto = {
      email: 'new@acme.com',
      firstName: 'New',
      lastName: 'Staff',
      roleIds: ['role-staff-id'],
    };

    it('happy path — creates user with status=invited', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.findFirst.mockResolvedValue({
        plan: { maxUsers: 25, name: 'Professional' },
      });
      mockPrisma.user.count.mockResolvedValue(5);
      mockPrisma.role.findMany.mockResolvedValue([{ id: 'role-staff-id' }]);
      mockPrisma.user.create.mockResolvedValue(mockUser({ email: 'new@acme.com', status: 'invited' }));

      const result = await service.invite(TENANT_ID, dto);

      expect(result.status).toBe('invited');
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'invited', passwordHash: '' }),
        }),
      );
    });

    it('duplicate email — throws UAM_USER_ALREADY_EXISTS (409)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser());

      await expect(service.invite(TENANT_ID, dto)).rejects.toMatchObject({
        code: 'UAM_USER_ALREADY_EXISTS',
        status: HttpStatus.CONFLICT,
      });
    });

    it('plan user limit reached — throws ORG_SUBSCRIPTION_USER_LIMIT (403)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.findFirst.mockResolvedValue({
        plan: { maxUsers: 5, name: 'Starter' },
      });
      mockPrisma.user.count.mockResolvedValue(5); // at limit

      await expect(service.invite(TENANT_ID, dto)).rejects.toMatchObject({
        code: 'ORG_SUBSCRIPTION_USER_LIMIT',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('no subscription — skips user limit check (unlimited)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.role.findMany.mockResolvedValue([{ id: 'role-staff-id' }]);
      mockPrisma.user.create.mockResolvedValue(mockUser({ status: 'invited' }));

      await expect(service.invite(TENANT_ID, dto)).resolves.toBeDefined();
    });

    it('role not found in tenant — throws UAM_ROLE_NOT_FOUND (404)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.findFirst.mockResolvedValue(null);
      mockPrisma.role.findMany.mockResolvedValue([]); // no matching roles

      await expect(service.invite(TENANT_ID, dto)).rejects.toMatchObject({
        code: 'UAM_ROLE_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  // ─── deactivate ──────────────────────────────────────────────────────────────

  describe('deactivate()', () => {
    it('happy path — sets status=inactive and revokes all tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser());
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.user.update.mockResolvedValue(mockUser({ status: 'inactive' }));

      const result = await service.deactivate(TENANT_ID, 'user-uuid-1');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-uuid-1', revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'inactive' } }),
      );
    });

    it('user not found — throws UAM_USER_NOT_FOUND (404)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivate(TENANT_ID, 'ghost-id')).rejects.toMatchObject({
        code: 'UAM_USER_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('user belongs to different tenant — throws UAM_USER_NOT_FOUND (404)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser({ tenantId: 'other-tenant' }));

      await expect(service.deactivate(TENANT_ID, 'user-uuid-1')).rejects.toMatchObject({
        code: 'UAM_USER_NOT_FOUND',
      });
    });
  });
});
