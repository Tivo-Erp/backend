import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';

interface SearchTypeConfig {
  table: string;
  title: string;
  subtitle: string | null;
  /** Module read permission required to surface hits of this type. */
  permission: string;
}

/**
 * Whitelisted searchable entities (INF-004 / ADR-015). Each maps to a table
 * with a generated `search_vector` (tsvector) column + GIN index created in the
 * batch-6 migration. Table/column names come ONLY from this constant — never
 * from the request — so the raw identifiers below cannot be injected.
 *
 * `permission` mirrors the @RequirePermissions code on each module's list
 * endpoint, so search never reveals titles the caller could not enumerate.
 */
const SEARCH_TYPES: Record<string, SearchTypeConfig> = {
  item: {
    table: 'items',
    title: 'name',
    subtitle: 'sku',
    permission: 'mat:item:read',
  },
  customer: {
    table: 'customers',
    title: 'name',
    subtitle: 'code',
    permission: 'sal:customer:read',
  },
  supplier: {
    table: 'suppliers',
    title: 'name',
    subtitle: 'code',
    permission: 'pur:supplier:read',
  },
  lead: {
    table: 'leads',
    title: 'companyName',
    subtitle: 'contactName',
    permission: 'crm:lead:read',
  },
  project: {
    table: 'projects',
    title: 'name',
    subtitle: 'code',
    permission: 'pmo:project:read',
  },
};

const PER_TYPE_LIMIT = 10;

export interface SearchCaller {
  permissions: string[];
  isSuperAdmin?: boolean;
}

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle: string | null;
  rank: number;
}

interface SearchRow {
  id: string;
  title: string;
  subtitle: string | null;
  rank: number;
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tenant-scoped global full-text search. Runs one parameterised `tsquery` per
   * requested type and merges the results ranked by `ts_rank`. Requested types
   * are intersected with the caller's per-module read permissions (unpermitted
   * types are silently dropped); an empty intersection yields empty results.
   */
  async search(
    tenantId: string,
    rawQuery: string,
    types: string[] | undefined,
    limit: number,
    caller: SearchCaller,
  ): Promise<{ query: string; total: number; results: SearchHit[] }> {
    const q = (rawQuery ?? '').trim();
    if (q.length < 2) {
      throw new BusinessException(
        'SEARCH_QUERY_TOO_SHORT',
        'Search query must be at least 2 characters',
        HttpStatus.BAD_REQUEST,
      );
    }

    const requested = this.resolveTypes(types);
    const permitted = this.filterByPermission(requested, caller);
    const cappedLimit = Math.min(Math.max(limit ?? 20, 1), 50);

    if (permitted.length === 0) {
      return { query: q, total: 0, results: [] };
    }

    // Run all per-type queries inside the RLS-aware transaction so
    // set_config('app.current_tenant_id', ...) applies; the parameterised
    // "tenantId" WHERE clause below stays as defense in depth.
    const perType = await this.prisma.$transaction(
      permitted.map((type) => this.queryType(tenantId, type, q)),
    );

    const merged = perType
      .flatMap((rows, i) =>
        rows.map((r) => ({
          type: permitted[i],
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          rank: Number(r.rank),
        })),
      )
      .sort((a, b) => b.rank - a.rank)
      .slice(0, cappedLimit);

    return { query: q, total: merged.length, results: merged };
  }

  private resolveTypes(types: string[] | undefined): string[] {
    if (!types || types.length === 0) return Object.keys(SEARCH_TYPES);
    const invalid = types.filter((t) => !SEARCH_TYPES[t]);
    if (invalid.length > 0) {
      throw new BusinessException(
        'SEARCH_INVALID_TYPE',
        `Unknown search type(s): ${invalid.join(', ')}. Allowed: ${Object.keys(SEARCH_TYPES).join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return types;
  }

  /** Intersect requested types with the caller's module read permissions. */
  private filterByPermission(
    requested: string[],
    caller: SearchCaller,
  ): string[] {
    if (caller?.isSuperAdmin) return requested;
    const granted = new Set(
      Array.isArray(caller?.permissions) ? caller.permissions : [],
    );
    return requested.filter((t) => granted.has(SEARCH_TYPES[t].permission));
  }

  private queryType(
    tenantId: string,
    type: string,
    q: string,
  ): Prisma.PrismaPromise<SearchRow[]> {
    const cfg = SEARCH_TYPES[type];
    const subtitleExpr = cfg.subtitle ? `"${cfg.subtitle}"` : 'NULL';
    return this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT id::text AS id,
             ${Prisma.raw(`"${cfg.title}"`)}::text AS title,
             ${Prisma.raw(subtitleExpr)}::text AS subtitle,
             ts_rank(search_vector, websearch_to_tsquery('simple', ${q})) AS rank
      FROM ${Prisma.raw(cfg.table)}
      WHERE "tenantId" = ${tenantId}::uuid
        AND search_vector @@ websearch_to_tsquery('simple', ${q})
      ORDER BY rank DESC
      LIMIT ${PER_TYPE_LIMIT}
    `);
  }
}
