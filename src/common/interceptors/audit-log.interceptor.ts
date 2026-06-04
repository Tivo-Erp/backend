import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditLogService } from '../../modules/uam/services/audit-log.service.js';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface.js';

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;

    if (!WRITE_METHODS.includes(method)) return next.handle();

    const user = request.user as JwtPayload | undefined;
    if (!user?.tenantId) return next.handle();

    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;
    const module = this.extractModule(controllerName);
    const action = `${method} ${handlerName}`;

    return next.handle().pipe(
      tap((responseData) => {
        const entityId =
          request.params?.id ||
          (responseData as Record<string, unknown>)?.id ||
          undefined;

        this.auditLogService
          .log({
            tenantId: user.tenantId,
            userId: user.sub,
            action,
            module,
            entityType: controllerName.replace('Controller', ''),
            entityId: entityId as string | undefined,
            changes: method === 'DELETE' ? null : request.body,
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
