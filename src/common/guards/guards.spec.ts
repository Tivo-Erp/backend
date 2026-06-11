import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TenantGuard } from './tenant.guard.js';
import { RbacGuard } from './rbac.guard.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { currentTenantId } from '../../infra/database/tenant-context.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildContext(
  user: any,
  handler?: object,
  cls?: object,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler ?? function namedHandler() {},
    getClass: () => cls ?? class NamedClass {},
  } as unknown as ExecutionContext;
}

// ─── TenantGuard ─────────────────────────────────────────────────────────────

describe('TenantGuard', () => {
  let guard: TenantGuard;
  const mockReflector = { getAllAndOverride: jest.fn() };
  const TENANT_ID = '0e3b4f1a-2c5d-4e6f-8a9b-0c1d2e3f4a5b';

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [TenantGuard, { provide: Reflector, useValue: mockReflector }],
    }).compile();
    guard = module.get(TenantGuard);
  });

  it('@Public() route — skips RLS setup, returns true', () => {
    mockReflector.getAllAndOverride.mockReturnValue(true); // isPublic = true
    const ctx = buildContext(null);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('authenticated request — binds tenant context and returns true', () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    const ctx = buildContext({ tenantId: TENANT_ID });
    expect(guard.canActivate(ctx)).toBe(true);
    expect(currentTenantId()).toBe(TENANT_ID);
  });

  it('request without tenantId (no user) — returns false', () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    const ctx = buildContext(null);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('non-UUID tenantId — returns false (no injection into RLS context)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(false);
    const ctx = buildContext({ tenantId: "x'; DROP TABLE users; --" });
    expect(guard.canActivate(ctx)).toBe(false);
  });
});

// ─── RbacGuard ────────────────────────────────────────────────────────────────

describe('RbacGuard', () => {
  let guard: RbacGuard;
  const mockReflector = { getAllAndOverride: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [RbacGuard, { provide: Reflector, useValue: mockReflector }],
    }).compile();
    guard = module.get(RbacGuard);
  });

  it('no @RequirePermissions on handler — returns true (open endpoint)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext({ permissions: [] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('user has required permission — returns true', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['po:create']);
    const ctx = buildContext({
      permissions: ['po:create', 'po:read'],
      isSuperAdmin: false,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('user missing required permission — throws AUTH_INSUFFICIENT_PERMISSIONS (403)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['po:create']);
    const ctx = buildContext({ permissions: ['po:read'], isSuperAdmin: false });
    expect(() => guard.canActivate(ctx)).toThrow(
      expect.objectContaining({ code: 'AUTH_INSUFFICIENT_PERMISSIONS' }),
    );
  });

  it('super admin — bypasses permission check', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['platform:tenant:create']);
    const ctx = buildContext({ permissions: [], isSuperAdmin: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
