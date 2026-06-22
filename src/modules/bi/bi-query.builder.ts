import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception.js';
import { CUBES, CubeDef } from './cube-registry.js';
import { OlapQueryDto } from './dto/bi.dto.js';

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

const MAX_DIMENSIONS = 5;
const MAX_MEASURES = 5;
const MAX_RANGE_MS = 2 * 366 * 24 * 60 * 60 * 1000; // ~2 years
const MAX_LIMIT = 10_000;

function fail(code: string, message: string): never {
  throw new BusinessException(code, message, HttpStatus.BAD_REQUEST);
}

/**
 * Translates a validated {@link OlapQueryDto} into a parameterized DuckDB query.
 *
 * Safety contract: every SQL fragment is drawn from the {@link CUBES} allow-list
 * (column identifiers are looked up, never taken verbatim from the client), and
 * `tenant_id = ?` is injected server-side as the FIRST predicate. Values
 * (tenant id, filter values, date bounds, limit) are always bound parameters.
 */
export function buildOlapQuery(
  tenantId: string,
  dto: OlapQueryDto,
): BuiltQuery {
  const cube: CubeDef | undefined = CUBES[dto.cube];
  if (!cube) fail('BI_UNKNOWN_CUBE', `Unknown cube: ${dto.cube}`);

  const rows = dto.rows ?? [];
  const columns = dto.columns ?? [];
  const dims = [...rows, ...columns];
  if (dims.length > MAX_DIMENSIONS) {
    fail(
      'BI_TOO_MANY_DIMENSIONS',
      `At most ${MAX_DIMENSIONS} dimensions allowed`,
    );
  }
  if (!dto.measures || dto.measures.length === 0) {
    fail('BI_NO_MEASURES', 'At least one measure is required');
  }
  if (dto.measures.length > MAX_MEASURES) {
    fail('BI_TOO_MANY_MEASURES', `At most ${MAX_MEASURES} measures allowed`);
  }

  // Resolve dimensions → physical columns.
  const dimCols = dims.map((d) => {
    const col = cube.dimensions[d];
    if (!col)
      fail(
        'BI_UNKNOWN_DIMENSION',
        `Unknown dimension "${d}" for cube ${dto.cube}`,
      );
    return { key: d, col };
  });

  // Resolve measures → aggregation expressions.
  const measureExprs = dto.measures.map((m) => {
    const def = cube.measures[m];
    if (!def)
      fail('BI_UNKNOWN_MEASURE', `Unknown measure "${m}" for cube ${dto.cube}`);
    return `${def.agg}(${def.column}) AS "${m}"`;
  });

  const params: unknown[] = [tenantId];
  const whereClauses: string[] = ['tenant_id = ?'];

  // Filters: equality on declared dimensions only.
  if (dto.filters) {
    for (const [key, value] of Object.entries(dto.filters)) {
      const col = cube.dimensions[key];
      if (!col) fail('BI_UNKNOWN_FILTER', `Unknown filter dimension "${key}"`);
      whereClauses.push(`${col} = ?`);
      params.push(value);
    }
  }

  // Date range.
  if (dto.dateFrom || dto.dateTo) {
    if (!cube.hasDateRange || !cube.dateColumn) {
      fail(
        'BI_NO_DATE_RANGE',
        `Cube ${dto.cube} does not support a date range`,
      );
    }
    if (dto.dateFrom && dto.dateTo) {
      const from = Date.parse(dto.dateFrom);
      const to = Date.parse(dto.dateTo);
      if (
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        to - from > MAX_RANGE_MS
      ) {
        fail('BI_RANGE_TOO_WIDE', 'Date range may not exceed 2 years');
      }
    }
    if (dto.dateFrom) {
      whereClauses.push(`${cube.dateColumn} >= ?`);
      params.push(dto.dateFrom);
    }
    if (dto.dateTo) {
      whereClauses.push(`${cube.dateColumn} <= ?`);
      params.push(dto.dateTo);
    }
  }

  const selectCols = [
    ...dimCols.map((d) => `${d.col} AS "${d.key}"`),
    ...measureExprs,
  ].join(', ');
  const groupBy = dimCols.length
    ? ` GROUP BY ${dimCols.map((d) => d.col).join(', ')}`
    : '';
  const orderBy = dimCols.length
    ? ` ORDER BY ${dimCols.map((d) => d.col).join(', ')}`
    : '';

  const limit = Math.min(Math.max(dto.limit ?? 1000, 1), MAX_LIMIT);

  const sql =
    `SELECT ${selectCols} FROM ${cube.factTable}` +
    ` WHERE ${whereClauses.join(' AND ')}` +
    groupBy +
    orderBy +
    ` LIMIT ${limit}`;

  return { sql, params };
}
