import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { appConfig } from './config/app.config.js';
import { DatabaseModule } from './infra/database/database.module.js';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    HealthModule,
    DatabaseModule,
    AuthModule,
    OrgModule,
    UamModule,
    MatModule,
    WmsModule,
    InvModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
