import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { appConfig } from './config/app.config.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { CacheModule } from './infra/cache/cache.module.js';
import { RedisThrottlerStorage } from './infra/cache/throttler-redis.storage.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { EmailModule } from './infra/email/email.module.js';
import { EventsModule } from './infra/events/events.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { OlapModule } from './infra/olap/olap.module.js';
import { ObservabilityModule } from './infra/observability/observability.module.js';
import { MetricsInterceptor } from './infra/observability/metrics.interceptor.js';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { TenantGuard } from './common/guards/tenant.guard.js';
import { RbacGuard } from './common/guards/rbac.guard.js';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';
import { HealthModule } from './common/health/health.module.js';
import { OrgModule } from './modules/org/org.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UamModule } from './modules/uam/uam.module.js';
import { MatModule } from './modules/mat/mat.module.js';
import { WmsModule } from './modules/wms/wms.module.js';
import { InvModule } from './modules/inv/inv.module.js';
import { PurModule } from './modules/pur/pur.module.js';
import { SalModule } from './modules/sal/sal.module.js';
import { FinModule } from './modules/fin/fin.module.js';
import { MfgModule } from './modules/mfg/mfg.module.js';
import { QcModule } from './modules/qc/qc.module.js';
import { HrmModule } from './modules/hrm/hrm.module.js';
import { WflModule } from './modules/wfl/wfl.module.js';
import { NtfModule } from './modules/ntf/ntf.module.js';
import { DelModule } from './modules/del/del.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { PmoModule } from './modules/pmo/pmo.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { ShpModule } from './modules/shp/shp.module.js';
import { BiModule } from './modules/bi/bi.module.js';
import type { JwtPayload } from './modules/auth/interfaces/jwt-payload.interface.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    // INF-006: structured JSON logging with correlationId from the request.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        autoLogging: {
          ignore: (req: IncomingMessage) =>
            req.url === '/metrics' || (req.url?.startsWith('/health') ?? false),
        },
        customProps: (req: IncomingMessage & { user?: JwtPayload }) => ({
          correlationId: req.headers['x-correlation-id'],
          tenantId: req.user?.tenantId,
        }),
        redact: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.headers["x-metrics-token"]',
        ],
      },
    }),
    // INF-007: rate-limit counters shared across instances when Redis is
    // configured; falls back to the in-memory store otherwise.
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [
          {
            ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
            limit: Number(process.env.THROTTLE_LIMIT ?? 120),
          },
        ],
        ...(process.env.REDIS_URL ? { storage } : {}),
      }),
    }),
    // ── Cross-cutting infrastructure (Batch 6) ──
    RedisModule,
    CacheModule,
    QueueModule,
    EmailModule,
    EventsModule,
    StorageModule,
    OlapModule,
    ObservabilityModule,
    HealthModule,
    DatabaseModule,
    AuthModule,
    OrgModule,
    UamModule,
    MatModule,
    WmsModule,
    InvModule,
    PurModule,
    SalModule,
    FinModule,
    MfgModule,
    QcModule,
    HrmModule,
    WflModule,
    NtfModule,
    DelModule,
    CrmModule,
    PmoModule,
    SearchModule,
    ShpModule,
    BiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
