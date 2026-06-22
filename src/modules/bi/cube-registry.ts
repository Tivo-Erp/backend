/**
 * Cube metadata (SRS_08 §2.2/§2.3). Each cube maps to one DuckDB fact table and
 * declares the dimensions (group-by columns) and measures (aggregations) a
 * client may reference. The query builder validates every requested dimension /
 * measure / filter against this registry, so a client can never reach an
 * unlisted column — the only SQL that runs is assembled from this allow-list
 * plus a server-injected `tenant_id = ?` predicate.
 */

export interface MeasureDef {
  /** Aggregation expression with `{col}` placeholder, e.g. `SUM({col})`. */
  agg: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
  column: string;
}

export interface CubeDef {
  factTable: string;
  /** dimension key → physical column. */
  dimensions: Record<string, string>;
  /** measure key → aggregation. */
  measures: Record<string, MeasureDef>;
  /** Column used for the dateFrom/dateTo range filter, if any. */
  dateColumn?: string;
  /** Whether a date range filter is meaningful for this cube. */
  hasDateRange: boolean;
}

export const CUBES: Record<string, CubeDef> = {
  fact_sales: {
    factTable: 'fact_sales',
    dateColumn: 'date_key',
    hasDateRange: true,
    dimensions: {
      year: 'year',
      month: 'month',
      customer: 'customer_name',
      customerId: 'customer_id',
      status: 'status',
    },
    measures: {
      orders: { agg: 'SUM', column: 'order_count' },
      gross: { agg: 'SUM', column: 'gross_amount' },
      tax: { agg: 'SUM', column: 'tax_amount' },
      net: { agg: 'SUM', column: 'net_amount' },
      avgNet: { agg: 'AVG', column: 'net_amount' },
    },
  },
  fact_purchases: {
    factTable: 'fact_purchases',
    dateColumn: 'date_key',
    hasDateRange: true,
    dimensions: {
      year: 'year',
      month: 'month',
      supplier: 'supplier_name',
      supplierId: 'supplier_id',
      status: 'status',
    },
    measures: {
      orders: { agg: 'SUM', column: 'order_count' },
      gross: { agg: 'SUM', column: 'gross_amount' },
      tax: { agg: 'SUM', column: 'tax_amount' },
      net: { agg: 'SUM', column: 'net_amount' },
    },
  },
  fact_inventory: {
    factTable: 'fact_inventory',
    hasDateRange: false,
    dimensions: {
      item: 'item_name',
      sku: 'sku',
      itemId: 'item_id',
      warehouse: 'warehouse_name',
      warehouseId: 'warehouse_id',
    },
    measures: {
      onHand: { agg: 'SUM', column: 'quantity_on_hand' },
      reserved: { agg: 'SUM', column: 'quantity_reserved' },
      value: { agg: 'SUM', column: 'stock_value' },
    },
  },
  fact_finance: {
    factTable: 'fact_finance',
    dateColumn: 'date_key',
    hasDateRange: true,
    dimensions: {
      year: 'year',
      month: 'month',
      account: 'account_code',
      accountType: 'account_type',
    },
    measures: {
      debit: { agg: 'SUM', column: 'debit_amount' },
      credit: { agg: 'SUM', column: 'credit_amount' },
    },
  },
  fact_hr: {
    factTable: 'fact_hr',
    hasDateRange: false,
    dimensions: {
      year: 'year',
      month: 'month',
      department: 'department',
      employeeId: 'employee_id',
    },
    measures: {
      headcount: { agg: 'SUM', column: 'headcount' },
      grossPay: { agg: 'SUM', column: 'gross_pay' },
      netPay: { agg: 'SUM', column: 'net_pay' },
      deductions: { agg: 'SUM', column: 'deductions' },
    },
  },
};

export const CUBE_NAMES = Object.keys(CUBES);
