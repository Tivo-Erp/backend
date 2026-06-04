import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/index.js';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface.js';
import { BusinessException } from '../exceptions/business.exception.js';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    if (user.isSuperAdmin) return true;

    const hasPermission = requiredPermissions.some((permission) =>
      user.permissions.includes(permission),
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
