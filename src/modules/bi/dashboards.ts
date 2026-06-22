import { OlapQueryDto } from './dto/bi.dto.js';

export type WidgetType = 'kpi' | 'bar' | 'line' | 'pie' | 'table';

export interface DashboardWidget {
  key: string;
  title: string;
  type: WidgetType;
  /** Pre-configured OLAP query (POST to /bi/query), or a real-time KPI source. */
  query?: OlapQueryDto;
  /** Real-time KPI endpoint suffix (read from OLTP) when there's no cube query. */
  realtime?: 'pipeline' | 'headcount';
  refreshIntervalMs: number;
  /** Roles that may see this widget. Empty ⇒ any authenticated user. */
  roles: string[];
}

const MIN = 60_000;

/**
 * Hardcoded role-gated dashboard widgets (SRS_08 §2.3). Each `query` is a valid
 * {@link OlapQueryDto} the client can replay against POST /api/v1/bi/query.
 */
export const DASHBOARDS: DashboardWidget[] = [
  {
    key: 'sales_by_month',
    title: 'Net Sales by Month',
    type: 'line',
    query: {
      cube: 'fact_sales',
      rows: ['year', 'month'],
      measures: ['net', 'orders'],
    },
    refreshIntervalMs: 15 * MIN,
    roles: ['tenant_owner', 'tenant_admin', 'manager'],
  },
  {
    key: 'sales_by_customer',
    title: 'Top Customers (Net)',
    type: 'bar',
    query: {
      cube: 'fact_sales',
      rows: ['customer'],
      measures: ['net'],
      limit: 10,
    },
    refreshIntervalMs: 15 * MIN,
    roles: ['tenant_owner', 'tenant_admin', 'manager'],
  },
  {
    key: 'purchases_by_supplier',
    title: 'Spend by Supplier',
    type: 'bar',
    query: {
      cube: 'fact_purchases',
      rows: ['supplier'],
      measures: ['net'],
      limit: 10,
    },
    refreshIntervalMs: 15 * MIN,
    roles: ['tenant_owner', 'tenant_admin', 'manager'],
  },
  {
    key: 'stock_value_by_warehouse',
    title: 'Stock Value by Warehouse',
    type: 'pie',
    query: { cube: 'fact_inventory', rows: ['warehouse'], measures: ['value'] },
    refreshIntervalMs: 15 * MIN,
    roles: [],
  },
  {
    key: 'payroll_by_department',
    title: 'Payroll Cost by Department',
    type: 'bar',
    query: {
      cube: 'fact_hr',
      rows: ['department'],
      measures: ['grossPay', 'headcount'],
    },
    refreshIntervalMs: 60 * MIN,
    roles: ['tenant_owner', 'tenant_admin'],
  },
  {
    key: 'pipeline_value',
    title: 'Open Pipeline Value',
    type: 'kpi',
    realtime: 'pipeline',
    refreshIntervalMs: 5 * MIN,
    roles: ['tenant_owner', 'tenant_admin', 'manager'],
  },
  {
    key: 'active_headcount',
    title: 'Active Headcount',
    type: 'kpi',
    realtime: 'headcount',
    refreshIntervalMs: 30 * MIN,
    roles: ['tenant_owner', 'tenant_admin'],
  },
];
