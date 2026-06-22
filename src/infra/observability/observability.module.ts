import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsInterceptor } from './metrics.interceptor.js';

/**
 * INF-006 — observability. Exposes the Prometheus registry + scrape endpoint
 * and the HTTP metrics interceptor (registered as a global APP_INTERCEPTOR in
 * AppModule). Structured logging (pino) is configured in AppModule and Sentry
 * is initialised in main.ts.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class ObservabilityModule {}
