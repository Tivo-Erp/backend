import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/index.js';
import { tenantContext } from '../../infra/database/tenant-context.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user?.tenantId || !UUID_RE.test(user.tenantId)) return false;

    // Bind the tenant id to this request's async context; PrismaService picks
    // it up to set the RLS context inside every transaction.
    tenantContext.enterWith(user.tenantId);
    return true;
  }
}
