import { buildOlapQuery } from './bi-query.builder.js';
import { BusinessException } from '../../common/exceptions/business.exception.js';

const tenantId = 't1';

/** Assert the builder rejects with a specific BI_* business code. */
function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    expect((e as BusinessException).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code} to be thrown`);
}

describe('buildOlapQuery', () => {
  it('builds a grouped, tenant-scoped query with bound params', () => {
    const { sql, params } = buildOlapQuery(tenantId, {
      cube: 'fact_sales',
      rows: ['year', 'month'],
      measures: ['net', 'orders'],
    });
    expect(sql).toContain('FROM fact_sales');
    expect(sql).toContain('WHERE tenant_id = ?');
    expect(sql).toContain('GROUP BY year, month');
    expect(sql).toMatch(/SUM\(net_amount\) AS "net"/);
    expect(sql).toMatch(/SUM\(order_count\) AS "orders"/);
    // tenant id is always the first bound parameter
    expect(params[0]).toBe(tenantId);
  });

  it('injects tenant_id as the first predicate even with filters + date range', () => {
    const { sql, params } = buildOlapQuery(tenantId, {
      cube: 'fact_sales',
      rows: ['customer'],
      measures: ['net'],
      filters: { status: 'fulfilled' },
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
    });
    expect(sql.indexOf('tenant_id = ?')).toBeLessThan(
      sql.indexOf('status = ?'),
    );
    expect(params).toEqual([tenantId, 'fulfilled', '2026-01-01', '2026-03-31']);
  });

  it('rejects an unknown cube', () => {
    expect(() =>
      buildOlapQuery(tenantId, {
        cube: 'fact_unknown',
        measures: ['net'],
      } as any),
    ).toThrow(BusinessException);
  });

  it('rejects an unknown dimension / measure / filter (no raw SQL reaches the store)', () => {
    expectCode(
      () =>
        buildOlapQuery(tenantId, {
          cube: 'fact_sales',
          rows: ['ssn'],
          measures: ['net'],
        }),
      'BI_UNKNOWN_DIMENSION',
    );
    expectCode(
      () =>
        buildOlapQuery(tenantId, {
          cube: 'fact_sales',
          measures: ['profit'],
        }),
      'BI_UNKNOWN_MEASURE',
    );
    expectCode(
      () =>
        buildOlapQuery(tenantId, {
          cube: 'fact_sales',
          measures: ['net'],
          filters: { "name'; DROP TABLE": 'x' },
        }),
      'BI_UNKNOWN_FILTER',
    );
  });

  it('enforces dimension/measure caps', () => {
    expect(() =>
      buildOlapQuery(tenantId, {
        cube: 'fact_sales',
        rows: ['year', 'month', 'customer'],
        columns: ['status', 'customerId'],
        measures: ['net'],
      } as any),
    ).not.toThrow(); // exactly 5 dims is allowed
    expectCode(
      () =>
        buildOlapQuery(tenantId, {
          cube: 'fact_sales',
          rows: ['year', 'month', 'customer', 'status', 'customerId'],
          columns: ['year'],
          measures: ['net'],
        }),
      'BI_TOO_MANY_DIMENSIONS',
    );
    expectCode(
      () => buildOlapQuery(tenantId, { cube: 'fact_sales', measures: [] }),
      'BI_NO_MEASURES',
    );
  });

  it('rejects a date range on a cube that has none', () => {
    expectCode(
      () =>
        buildOlapQuery(tenantId, {
          cube: 'fact_inventory',
          rows: ['warehouse'],
          measures: ['value'],
          dateFrom: '2026-01-01',
        }),
      'BI_NO_DATE_RANGE',
    );
  });

  it('rejects a date range wider than 2 years', () => {
    expectCode(
      () =>
        buildOlapQuery(tenantId, {
          cube: 'fact_sales',
          measures: ['net'],
          dateFrom: '2020-01-01',
          dateTo: '2026-01-01',
        }),
      'BI_RANGE_TOO_WIDE',
    );
  });
});
