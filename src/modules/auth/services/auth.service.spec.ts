import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';

jest.mock('bcryptjs');
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { AuthTokenService } from './auth-token.service.js';

const mockUser = (overrides = {}) => ({
  id: 'user-uuid-1',
  tenantId: 'tenant-uuid-1',
  email: 'owner@acme.com',
  passwordHash: '$2a$12$hashedpassword',
  firstName: 'John',
  lastName: 'Doe',
  status: 'active',
  isSuperAdmin: false,
  failedLoginCount: 0,
  lockedUntil: null,
  deletedAt: null,
  tenant: {
    id: 'tenant-uuid-1',
    slug: 'acme',
    status: 'active',
  },
  ...overrides,
});

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  userRole: {
    findMany: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockAuthTokens = {
  issue: jest.fn().mockResolvedValue('challenge-token'),
  consume: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: any) => {
    const map: Record<string, any> = {
      'app.jwtRefreshTtl': 604800,
      'app.jwtAccessTtl': 3600,
      'app.authMaxFailedAttempts': 5,
      'app.authLockDurationSec': 1800,
    };
    return map[key] ?? defaultVal;
  }),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: passwords match; individual tests override as needed
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: AuthTokenService, useValue: mockAuthTokens },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // Default: loadRolesAndPermissions returns empty
    mockPrisma.userRole.findMany.mockResolvedValue([]);
    // Default: refresh token create returns a row id (issueTokens needs it)
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-new-id' });
    mockPrisma.refreshToken.update.mockResolvedValue({});
    // Default: rotation claim succeeds
    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    // Default: user update ok
    mockPrisma.user.update.mockResolvedValue({});
  });

  // ─── login ───────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('happy path — returns accessToken, refreshToken, user info', async () => {
      const user = mockUser();
      mockPrisma.user.findMany.mockResolvedValue([user]);

      const result: any = await service.login({
        email: 'owner@acme.com',
        password: 'anypass',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(3600);
      expect(result.user.email).toBe('owner@acme.com');
      expect(result.user.tenantId).toBe('tenant-uuid-1');
    });

    it('wrong password — atomically increments failedLoginCount, throws AUTH_INVALID_CREDENTIALS', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const user = mockUser({ failedLoginCount: 0 });
      mockPrisma.user.findMany.mockResolvedValue([user]);
      mockPrisma.user.update.mockResolvedValue({
        ...user,
        failedLoginCount: 1,
      });

      await expect(
        service.login({ email: 'owner@acme.com', password: 'wrongpassword' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { failedLoginCount: { increment: 1 } },
        }),
      );
    });

    it('5th failed attempt — locks account but still throws generic AUTH_INVALID_CREDENTIALS', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const user = mockUser({ failedLoginCount: 4 });
      mockPrisma.user.findMany.mockResolvedValue([user]);
      mockPrisma.user.update.mockResolvedValueOnce({
        ...user,
        failedLoginCount: 5,
        lockedUntil: null,
      });

      await expect(
        service.login({ email: 'owner@acme.com', password: 'wrongpassword' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

      const lockCall = mockPrisma.user.update.mock.calls[1][0];
      expect(lockCall.data.lockedUntil).toBeInstanceOf(Date);
    });

    it('locked account (lockedUntil in future) — throws AUTH_ACCOUNT_LOCKED after valid password', async () => {
      const futureDate = new Date(Date.now() + 20 * 60 * 1000);
      const user = mockUser({ lockedUntil: futureDate });
      mockPrisma.user.findMany.mockResolvedValue([user]);

      await expect(
        service.login({ email: 'owner@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_LOCKED' });
    });

    it('locked account (lockedUntil in past) — proceeds to login and resets lock state', async () => {
      const pastDate = new Date(Date.now() - 60 * 1000);
      const user = mockUser({ lockedUntil: pastDate, failedLoginCount: 5 });
      mockPrisma.user.findMany.mockResolvedValue([user]);

      // Login should succeed (bcrypt.compare mocked to true by default)
      await service.login({ email: 'owner@acme.com', password: 'anypass' });

      // Success bookkeeping resets the lockout state
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            failedLoginCount: 0,
            lockedUntil: null,
          }),
        }),
      );
    });

    it('inactive user — throws AUTH_ACCOUNT_INACTIVE', async () => {
      const user = mockUser({ status: 'inactive' });
      mockPrisma.user.findMany.mockResolvedValue([user]);

      await expect(
        service.login({ email: 'owner@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_INACTIVE' });
    });

    it('invited user — throws AUTH_ACCOUNT_INACTIVE', async () => {
      const user = mockUser({ status: 'invited' });
      mockPrisma.user.findMany.mockResolvedValue([user]);

      await expect(
        service.login({ email: 'owner@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_ACCOUNT_INACTIVE' });
    });

    it('suspended tenant — throws AUTH_TENANT_SUSPENDED', async () => {
      const user = mockUser({
        tenant: { id: 'tenant-uuid-1', slug: 'acme', status: 'suspended' },
      });
      mockPrisma.user.findMany.mockResolvedValue([user]);

      await expect(
        service.login({ email: 'owner@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_TENANT_SUSPENDED' });
    });

    it('user not found — throws AUTH_INVALID_CREDENTIALS', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.login({ email: 'notfound@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });

    it('multi-tenant (same email, multiple tenants, no slug) — throws AUTH_MULTIPLE_TENANTS', async () => {
      const user1 = mockUser({ id: 'u1', tenantId: 't1' });
      const user2 = mockUser({ id: 'u2', tenantId: 't2' });
      mockPrisma.user.findMany.mockResolvedValue([user1, user2]);

      await expect(
        service.login({ email: 'owner@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_MULTIPLE_TENANTS' });
    });

    it('soft-deleted user — treated as not found', async () => {
      // deletedAt: null filter means soft-deleted users are excluded at DB level
      // When filter applies correctly, findMany returns []
      mockPrisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.login({ email: 'deleted@acme.com', password: 'anypass' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });
  });

  // ─── refresh ─────────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('valid token — rotates: returns new access + refresh token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-old-id',
        tokenHash: 'hash-of-valid-token',
        familyId: 'fam-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60000),
        userId: 'user-uuid-1',
      });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser());

      const result = await service.refresh({ refreshToken: 'valid-token' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(3600);
      // old token claimed (revoked) then linked to its replacement
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'rt-old-id' }),
        }),
      );
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { replacedById: 'rt-new-id' } }),
      );
    });

    it('reused (already revoked) token — revokes family, throws AUTH_REFRESH_TOKEN_REUSED', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-old-id',
        tokenHash: 'hash-of-revoked-token',
        familyId: 'fam-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        userId: 'user-uuid-1',
      });

      await expect(
        service.refresh({ refreshToken: 'revoked-token' }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_TOKEN_REUSED' });
      // whole family revoked on reuse
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ familyId: 'fam-1' }),
        }),
      );
    });

    it('token not found — throws AUTH_REFRESH_TOKEN_INVALID', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(
        service.refresh({ refreshToken: 'ghost-token' }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_TOKEN_INVALID' });
    });

    it('expired token — throws AUTH_REFRESH_TOKEN_EXPIRED', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-old-id',
        tokenHash: 'hash-of-old-token',
        familyId: 'fam-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000), // past
        userId: 'user-uuid-1',
      });

      await expect(
        service.refresh({ refreshToken: 'old-token' }),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_TOKEN_EXPIRED' });
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────────────

  describe('logout()', () => {
    it('revokes the refresh token', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('some-refresh-token');

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: expect.any(String), revokedAt: null },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ─── getTenantsForCredentials ──────────────────────────────────────────────

  describe('getTenantsForCredentials()', () => {
    it('returns matching tenants when password is valid', async () => {
      const u1 = mockUser({
        tenantId: 't1',
        tenant: { id: 't1', slug: 'acme', name: 'Acme', logoUrl: null },
      });
      const u2 = mockUser({
        id: 'user-uuid-2',
        tenantId: 't2',
        tenant: { id: 't2', slug: 'globex', name: 'Globex', logoUrl: 'x.png' },
      });
      mockPrisma.user.findMany.mockResolvedValue([u1, u2]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.getTenantsForCredentials(
        'owner@acme.com',
        'anypass',
      );

      expect(result.tenants).toEqual([
        { tenantId: 't1', tenantSlug: 'acme', tenantName: 'Acme', logoUrl: null },
        {
          tenantId: 't2',
          tenantSlug: 'globex',
          tenantName: 'Globex',
          logoUrl: 'x.png',
        },
      ]);
    });

    it('excludes tenants whose password does not match', async () => {
      const u1 = mockUser({
        tenant: { id: 't1', slug: 'acme', name: 'Acme', logoUrl: null },
      });
      const u2 = mockUser({
        id: 'user-uuid-2',
        tenant: { id: 't2', slug: 'globex', name: 'Globex', logoUrl: null },
      });
      mockPrisma.user.findMany.mockResolvedValue([u1, u2]);
      // first matches, second does not
      (bcrypt.compare as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result = await service.getTenantsForCredentials(
        'owner@acme.com',
        'anypass',
      );

      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0].tenantSlug).toBe('acme');
    });

    it('no matching email — pays bcrypt cost and returns empty list (anti-enumeration)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.getTenantsForCredentials(
        'ghost@nowhere.com',
        'anypass',
      );

      expect(result.tenants).toEqual([]);
      expect(bcrypt.compare).toHaveBeenCalled();
    });
  });

  // ─── getProfile ────────────────────────────────────────────────────────────

  describe('getProfile()', () => {
    it('returns the current user profile with roles and permissions', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(
        mockUser({
          avatarUrl: 'a.png',
          mfaEnabled: true,
          emailVerifiedAt: null,
          lastLoginAt: null,
          tenant: { id: 'tenant-uuid-1', slug: 'acme', name: 'Acme' },
        }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([
        {
          role: {
            name: 'admin',
            rolePermissions: [{ permission: { code: 'uam:user:read' } }],
          },
        },
      ]);

      const result = await service.getProfile('user-uuid-1');

      expect(result.id).toBe('user-uuid-1');
      expect(result.tenantSlug).toBe('acme');
      expect(result.tenantName).toBe('Acme');
      expect(result.roles).toEqual(['admin']);
      expect(result.permissions).toEqual(['uam:user:read']);
    });

    it('throws AUTH_ACCOUNT_INACTIVE when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toMatchObject({
        code: 'AUTH_ACCOUNT_INACTIVE',
      });
    });
  });
});
