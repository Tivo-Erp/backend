import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DuckDbService } from '../../../infra/olap/duckdb.service.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { buildOlapQuery } from '../bi-query.builder.js';
import { OlapQueryDto } from '../dto/bi.dto.js';
import { DASHBOARDS } from '../dashboards.js';

const QUERY_TIMEOUT_MS = 30_000;

@Injectable()
export class BiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly duck: DuckDbService,
  ) {}

  /** Run a validated OLAP query against the tenant's slice of the cube. */
  async query(tenantId: string, dto: OlapQueryDto) {
    const { sql, params } = buildOlapQuery(tenantId, dto);
    const rows = await this.withTimeout(
      this.duck.all(sql, ...params),
      QUERY_TIMEOUT_MS,
      'BI_QUERY_TIMEOUT',
    );
    return {
      cube: dto.cube,
      rows,
      rowCount: rows.length,
    };
  }

  /**
   * Dashboard catalog. Widgets are role-gated (hardcoded per SRS_08 §2.3 — no
   * per-tenant custom dashboards yet). Light real-time KPIs (pipeline value,
   * headcount) read OLTP directly so they don't wait on the ETL cycle.
   */
  dashboards(roles: string[]) {
    const roleSet = new Set(roles);
    const widgets = DASHBOARDS.filter(
      (w) => w.roles.length === 0 || w.roles.some((r) => roleSet.has(r)),
    ).map((w) => {
      // Strip the role-gating list from the response — clients see only the
      // widgets they're allowed, not the gating rules themselves.
      const { roles: _roles, ...rest } = w;
      void _roles;
      return rest;
    });
    return {
      olapAvailable: this.duck.configured,
      widgets,
    };
  }

  /** Real-time KPI: open sales-pipeline value (OLTP, not OLAP). */
  async pipelineValue(tenantId: string) {
    const result = await this.prisma.opportunity.aggregate({
      where: { tenantId, status: 'open' },
      _sum: { expectedRevenue: true },
      _count: true,
    });
    return {
      source: 'oltp',
      openOpportunities: result._count,
      expectedRevenue: Number(result._sum.expectedRevenue ?? 0),
    };
  }

  /** Real-time KPI: active headcount (OLTP). */
  async headcount(tenantId: string) {
    const count = await this.prisma.employee.count({
      where: { tenantId, status: { in: ['active', 'probation', 'on_leave'] } },
    });
    return { source: 'oltp', activeHeadcount: count };
  }

  private withTimeout<T>(p: Promise<T>, ms: number, code: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new BusinessException(
              code,
              'BI query exceeded the time budget',
              HttpStatus.GATEWAY_TIMEOUT,
            ),
          ),
        ms,
      );
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }
}
