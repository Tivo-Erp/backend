import {
  Controller,
  Get,
  Inject,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../decorators/index.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import {
  REDIS_CLIENT,
  type RedisClient,
} from '../../infra/redis/redis.module.js';

type CheckState = 'up' | 'down' | 'disabled';

/**
 * OPS-001 — health probes. `/health` is a lightweight liveness ping (used by
 * Docker HEALTHCHECK); `/health/ready` is a deep readiness probe that verifies
 * the DB (`SELECT 1`) and Redis (`PING`) so a load balancer only routes traffic
 * once dependencies are reachable. Redis being unconfigured is reported as
 * `disabled` (not a failure) per the optional-infra principle.
 */
@ApiTags('System')
@Controller('health')
export class HealthController {
  private readonly metricsToken: string;
  private readonly isProduction = process.env.NODE_ENV === 'production';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClient,
    config: ConfigService,
  ) {
    this.metricsToken = config.get<string>('app.metricsToken', '');
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Liveness',
    description:
      'Process is up. Used by Docker HEALTHCHECK and load balancers.',
  })
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Checks database + Redis connectivity; 503 if a required dependency is down.',
  })
  async ready(@Req() req: FastifyRequest) {
    const [database, cache] = await Promise.all([
      this.checkDb(),
      this.checkRedis(),
    ]);
    const healthy = database === 'up' && cache !== 'down';
    // Per-check breakdown is only disclosed outside production, or to callers
    // presenting the metrics token — unauthenticated prod callers get a bare
    // status (correct 200/503 still drives orchestrators).
    const detailed = !this.isProduction || this.hasValidToken(req);
    const body = detailed
      ? {
          status: healthy ? 'ok' : 'error',
          timestamp: new Date().toISOString(),
          checks: { database, cache },
        }
      : { status: healthy ? 'ok' : 'error' };
    if (!healthy) throw new ServiceUnavailableException(body);
    return body;
  }

  /** Metrics-style token check (Bearer or x-metrics-token), constant-time. */
  private hasValidToken(req: FastifyRequest): boolean {
    if (!this.metricsToken) return false;
    const authHeader = req.headers.authorization;
    const metricsHeader = req.headers['x-metrics-token'];
    const provided =
      authHeader?.replace(/^Bearer\s+/i, '') ||
      (typeof metricsHeader === 'string' ? metricsHeader : '') ||
      '';
    if (!provided) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(this.metricsToken, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async checkDb(): Promise<CheckState> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<CheckState> {
    if (!this.redis) return 'disabled';
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
