import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/index.js';
import { MetricsService } from './metrics.service.js';

/**
 * INF-006 — Prometheus scrape endpoint. Marked `@Public` (no JWT) because the
 * scraper is unauthenticated, but gated behind a shared `METRICS_TOKEN`
 * presented via header only (`Authorization: Bearer <token>` or
 * `x-metrics-token`). Query-string tokens are NOT accepted (they leak into
 * logs/proxies). In production the endpoint fails CLOSED when no token is
 * configured; in non-production it stays open for dev convenience.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);
  private readonly token: string;
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor(
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.token = config.get<string>('app.metricsToken', '');
    if (this.isProduction && !this.token) {
      this.logger.warn(
        'METRICS_TOKEN is not configured in production — /metrics will return 403 for all requests (fail closed). Set METRICS_TOKEN to enable scraping.',
      );
    }
  }

  @Public()
  @Get()
  async scrape(@Req() req: FastifyRequest, @Res() res: FastifyReply) {
    if (!this.token) {
      // Fail closed in production when no token is configured.
      if (this.isProduction) {
        throw new ForbiddenException('Metrics endpoint disabled');
      }
      // Non-production with no token: keep open for dev convenience.
    } else {
      const metricsTokenHeader = req.headers['x-metrics-token'];
      const provided =
        req.headers.authorization?.replace(/^Bearer\s+/i, '') ||
        (typeof metricsTokenHeader === 'string' ? metricsTokenHeader : '') ||
        '';
      if (!this.tokensMatch(provided)) {
        throw new ForbiddenException('Invalid metrics token');
      }
    }
    const body = await this.metrics.metrics();
    res.header('Content-Type', this.metrics.contentType);
    res.send(body);
  }

  /** Constant-time comparison, guarded against length mismatch. */
  private tokensMatch(provided: string): boolean {
    if (!provided) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(this.token, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
