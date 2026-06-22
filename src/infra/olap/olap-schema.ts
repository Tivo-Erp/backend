/**
 * DuckDB star-schema (ADR-011 / SRS_08 §2.2). Five fact tables + conformed
 * dimensions, all carrying `tenant_id` so a single column store serves every
 * tenant with mandatory tenant-scoping at query time.
 *
 * The DDL is intentionally simple (no DuckDB-specific types beyond the basics)
 * so it stays portable and the ETL can TRUNCATE-and-reload per tenant.
 */
export const OLAP_DDL: string[] = [
  // ── Dimensions ──
  `CREATE TABLE IF NOT EXISTS dim_time (
     date_key DATE,
     year INTEGER, quarter INTEGER, month INTEGER, day INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS dim_item (
     tenant_id VARCHAR, item_id VARCHAR, sku VARCHAR, name VARCHAR, category VARCHAR
   )`,
  `CREATE TABLE IF NOT EXISTS dim_customer (
     tenant_id VARCHAR, customer_id VARCHAR, code VARCHAR, name VARCHAR
   )`,
  `CREATE TABLE IF NOT EXISTS dim_supplier (
     tenant_id VARCHAR, supplier_id VARCHAR, code VARCHAR, name VARCHAR
   )`,
  `CREATE TABLE IF NOT EXISTS dim_warehouse (
     tenant_id VARCHAR, warehouse_id VARCHAR, code VARCHAR, name VARCHAR
   )`,
  `CREATE TABLE IF NOT EXISTS dim_employee (
     tenant_id VARCHAR, employee_id VARCHAR, code VARCHAR, department VARCHAR
   )`,
  // ── Facts ──
  `CREATE TABLE IF NOT EXISTS fact_sales (
     tenant_id VARCHAR, date_key DATE, year INTEGER, month INTEGER,
     customer_id VARCHAR, customer_name VARCHAR,
     so_id VARCHAR, status VARCHAR,
     order_count INTEGER, gross_amount DOUBLE, tax_amount DOUBLE, net_amount DOUBLE
   )`,
  `CREATE TABLE IF NOT EXISTS fact_purchases (
     tenant_id VARCHAR, date_key DATE, year INTEGER, month INTEGER,
     supplier_id VARCHAR, supplier_name VARCHAR,
     po_id VARCHAR, status VARCHAR,
     order_count INTEGER, gross_amount DOUBLE, tax_amount DOUBLE, net_amount DOUBLE
   )`,
  `CREATE TABLE IF NOT EXISTS fact_inventory (
     tenant_id VARCHAR, item_id VARCHAR, sku VARCHAR, item_name VARCHAR,
     warehouse_id VARCHAR, warehouse_name VARCHAR,
     quantity_on_hand DOUBLE, quantity_reserved DOUBLE, stock_value DOUBLE
   )`,
  `CREATE TABLE IF NOT EXISTS fact_finance (
     tenant_id VARCHAR, date_key DATE, year INTEGER, month INTEGER,
     account_code VARCHAR, account_type VARCHAR,
     debit_amount DOUBLE, credit_amount DOUBLE
   )`,
  `CREATE TABLE IF NOT EXISTS fact_hr (
     tenant_id VARCHAR, year INTEGER, month INTEGER,
     employee_id VARCHAR, department VARCHAR,
     headcount INTEGER, gross_pay DOUBLE, net_pay DOUBLE, deductions DOUBLE
   )`,
];
