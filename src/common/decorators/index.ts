import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface.js';
import type { AuthenticatedRequest } from '../types/authenticated-request.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user?.tenantId,
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

/** Extract roles array from JWT for FieldSelector usage */
export const CurrentUserRoles = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user?.roles || [],
);

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
