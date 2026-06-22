import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { FastifyRequest } from 'fastify';
import { AuditLogService } from '../../modules/uam/services/audit-log.service.js';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface.js';

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

/** Request augmented by the auth layer with the decoded JWT payload. */
interface AuthedRequest extends FastifyRequest {
  user?: JwtPayload;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const method = request.method;

    if (!WRITE_METHODS.includes(method)) return next.handle();

    const user = request.user;
    if (!user?.tenantId) return next.handle();

    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;
    const module = this.extractModule(controllerName);
    const action = `${method} ${handlerName}`;

    return next.handle().pipe(
      tap((responseData: unknown) => {
        const params = request.params as { id?: string } | undefined;
        const responseId =
          typeof responseData === 'object' && responseData !== null
            ? (responseData as Record<string, unknown>).id
            : undefined;
        const entityId =
          typeof (params?.id ?? responseId) === 'string'
            ? ((params?.id ?? responseId) as string)
            : undefined;
        const body =
          typeof request.body === 'object' && request.body !== null
            ? (request.body as Record<string, unknown>)
            : null;

        this.auditLogService
          .log({
            tenantId: user.tenantId,
            userId: user.sub,
            action,
            module,
            entityType: controllerName.replace('Controller', ''),
            entityId,
            changes: method === 'DELETE' ? null : body,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
          })
          .catch(() => {
            // Audit log failure should not break the request
          });
      }),
    );
  }

  private extractModule(controllerName: string): string {
    if (controllerName.includes('Tenant') || controllerName.includes('Branch'))
      return 'ORG';
    if (
      controllerName.includes('User') ||
      controllerName.includes('Role') ||
      controllerName.includes('Permission')
    )
      return 'UAM';
    if (controllerName.includes('Auth')) return 'AUTH';
    return 'SYSTEM';
  }
}
