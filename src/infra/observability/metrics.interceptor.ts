import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MetricsService } from './metrics.service.js';

/** Error shape carrying an HTTP status (NestJS / Fastify HTTP errors). */
interface HttpErrorLike {
  status?: number;
  statusCode?: number;
}

function statusFromError(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const e = err as HttpErrorLike;
    return e.status ?? e.statusCode ?? 500;
  }
  return 500;
}

/**
 * Records latency + status for every HTTP request into Prometheus (INF-006).
 * Uses the matched route template (Fastify `routerPath`) as the label so
 * cardinality stays bounded — never the raw URL with ids.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const start = process.hrtime.bigint();
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();
    const method = req.method ?? 'UNKNOWN';

    // `routerPath` is a legacy Fastify field not present on the current type;
    // read it through a narrow optional view rather than `any`.
    const legacyRouterPath = (req as { routerPath?: string }).routerPath;

    const record = (status: number) => {
      const route =
        req.routeOptions?.url ?? legacyRouterPath ?? req.url ?? 'unknown';
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.recordHttp(method, route, status, durationSec);
    };

    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode ?? 200),
        error: (err: unknown) => record(statusFromError(err)),
      }),
    );
  }
}
