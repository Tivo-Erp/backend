import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/index.js';
import { BusinessException } from '../exceptions/business.exception.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (user?.isSuperAdmin) return true;

    const granted = Array.isArray(user?.permissions) ? user.permissions : [];
    const hasPermission = requiredPermissions.some((permission) =>
      granted.includes(permission),
    );

    if (!hasPermission) {
      throw new BusinessException(
        'AUTH_INSUFFICIENT_PERMISSIONS',
        `Missing required permission: ${requiredPermissions.join(', ')}`,
        HttpStatus.FORBIDDEN,
      );
    }

    return true;
  }
}
