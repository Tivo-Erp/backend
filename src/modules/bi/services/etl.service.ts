import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DuckDbService } from '../../../infra/olap/duckdb.service.js';

const num = (d: { toString(): string } | null | undefined): number =>
  d == null ? 0 : Number(d.toString());

function monthKey(date: Date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  // date_key normalized to the first of the month (UTC).
  const dateKey = `${y}-${String(m).padStart(2, '0')}-01`;
  return { y, m, dateKey };
}

/**
 * BI-001 ETL: reload the DuckDB fact tables from the OLTP store, one tenant at
 * a time. Runs in the worker process on a repeatable BullMQ schedule (and can
 * be triggered ad-hoc). Each fact is a TRUNCATE-tenant-then-reload so a re-run
 * is idempotent. No-op-safe: when DuckDB is unconfigured the sync is skipped.
 *
 * Sales/purchases/finance are aggregated by month; inventory + HR are current
 * snapshots. Tenant isolation is structural — every row carries `tenant_id`.
 */
@Injectable()
export class EtlService {
  private readonly logger = new Logger(EtlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly duck: DuckDbService,
  ) {}

  /** Sync every active tenant. Skips silently when OLAP is unavailable. */
  async syncAll(): Promise<void> {
    if (!this.duck.configured) {
      this.logger.debug('OLAP not configured — ETL skipped.');
      return;
    }
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let ok = 0;
    for (const t of tenants) {
      try {
        await this.syncTenant(t.id);
        ok++;
      } catch (err) {
        this.logger.error(
          `ETL failed for tenant ${t.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`ETL sync: ${ok}/${tenants.length} tenants refreshed.`);
  }

  async syncTenant(tenantId: string): Promise<void> {
    if (!this.duck.configured) return;
    await this.syncSales(tenantId);
    await this.syncPurchases(tenantId);
    await this.syncInventory(tenantId);
    await this.syncFinance(tenantId);
    await this.syncHr(tenantId);
  }

  // ── fact_sales ────────────────────────────────────────────────
  private async syncSales(tenantId: string) {
    const orders = await this.prisma.salesOrder.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        orderDate: true,
        customerId: true,
        grandTotal: true,
        taxAmount: true,
        customer: { select: { name: true } },
      },
    });
    const rows = orders.map((o) => {
      const { y, m, dateKey } = monthKey(o.orderDate);
      const gross = num(o.grandTotal);
      const tax = num(o.taxAmount);
      return {
        tenant_id: tenantId,
        date_key: dateKey,
        year: y,
        month: m,
        customer_id: o.customerId,
        customer_name: o.customer?.name ?? null,
        so_id: o.id,
        status: o.status,
        order_count: 1,
        gross_amount: gross,
        tax_amount: tax,
        net_amount: gross - tax,
      };
    });
    await this.duck.reloadTenantTable('fact_sales', tenantId, rows, [
      'tenant_id',
      'date_key',
      'year',
      'month',
      'customer_id',
      'customer_name',
      'so_id',
      'status',
      'order_count',
      'gross_amount',
      'tax_amount',
      'net_amount',
    ]);
  }

  // ── fact_purchases ────────────────────────────────────────────
  private async syncPurchases(tenantId: string) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        orderDate: true,
        supplierId: true,
        grandTotal: true,
        taxAmount: true,
        supplier: { select: { name: true } },
      },
    });
    const rows = orders.map((o) => {
      const { y, m, dateKey } = monthKey(o.orderDate);
      const gross = num(o.grandTotal);
      const tax = num(o.taxAmount);
      return {
        tenant_id: tenantId,
        date_key: dateKey,
        year: y,
        month: m,
        supplier_id: o.supplierId,
        supplier_name: o.supplier?.name ?? null,
        po_id: o.id,
        status: o.status,
        order_count: 1,
        gross_amount: gross,
        tax_amount: tax,
        net_amount: gross - tax,
      };
    });
    await this.duck.reloadTenantTable('fact_purchases', tenantId, rows, [
      'tenant_id',
      'date_key',
      'year',
      'month',
      'supplier_id',
      'supplier_name',
      'po_id',
      'status',
      'order_count',
      'gross_amount',
      'tax_amount',
      'net_amount',
    ]);
  }

  // ── fact_inventory (current snapshot) ─────────────────────────
  private async syncInventory(tenantId: string) {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { tenantId },
      select: {
        itemId: true,
        warehouseId: true,
        quantityOnHand: true,
        quantityReserved: true,
        costPerUnit: true,
        item: { select: { sku: true, name: true } },
        warehouse: { select: { name: true } },
      },
    });
    const rows = balances.map((b) => {
      const onHand = num(b.quantityOnHand);
      return {
        tenant_id: tenantId,
        item_id: b.itemId,
        sku: b.item?.sku ?? null,
        item_name: b.item?.name ?? null,
        warehouse_id: b.warehouseId,
        warehouse_name: b.warehouse?.name ?? null,
        quantity_on_hand: onHand,
        quantity_reserved: num(b.quantityReserved),
        stock_value: onHand * num(b.costPerUnit),
      };
    });
    await this.duck.reloadTenantTable('fact_inventory', tenantId, rows, [
      'tenant_id',
      'item_id',
      'sku',
      'item_name',
      'warehouse_id',
      'warehouse_name',
      'quantity_on_hand',
      'quantity_reserved',
      'stock_value',
    ]);
  }

  // ── fact_finance (posted journal entries) ─────────────────────
  private async syncFinance(tenantId: string) {
    const batches = await this.prisma.journalBatch.findMany({
      where: { tenantId, status: 'posted' },
      select: {
        journalDate: true,
        entries: {
          select: { accountCode: true, debitAmount: true, creditAmount: true },
        },
      },
    });
    const accounts = await this.prisma.chartOfAccount.findMany({
      where: { tenantId },
      select: { accountCode: true, accountType: true },
    });
    const typeByCode = new Map(
      accounts.map((a) => [a.accountCode, a.accountType]),
    );
    const rows: Record<string, unknown>[] = [];
    for (const b of batches) {
      const { y, m, dateKey } = monthKey(b.journalDate);
      for (const e of b.entries) {
        rows.push({
          tenant_id: tenantId,
          date_key: dateKey,
          year: y,
          month: m,
          account_code: e.accountCode,
          account_type: typeByCode.get(e.accountCode) ?? null,
          debit_amount: num(e.debitAmount),
          credit_amount: num(e.creditAmount),
        });
      }
    }
    await this.duck.reloadTenantTable('fact_finance', tenantId, rows, [
      'tenant_id',
      'date_key',
      'year',
      'month',
      'account_code',
      'account_type',
      'debit_amount',
      'credit_amount',
    ]);
  }

  // ── fact_hr (approved payroll lines) ──────────────────────────
  private async syncHr(tenantId: string) {
    const runs = await this.prisma.payrollRun.findMany({
      where: { tenantId, status: { in: ['approved', 'paid'] } },
      select: {
        year: true,
        month: true,
        lines: {
          select: {
            employeeId: true,
            grossSalary: true,
            netSalary: true,
            empBHXH: true,
            empBHYT: true,
            empBHTN: true,
            pitAmount: true,
          },
        },
      },
    });
    const depByEmployee = new Map<string, string | null>();
    const employees = await this.prisma.employee.findMany({
      where: { tenantId },
      select: { id: true, departmentId: true },
    });
    for (const e of employees) depByEmployee.set(e.id, e.departmentId ?? null);

    const rows: Record<string, unknown>[] = [];
    for (const run of runs) {
      for (const l of run.lines) {
        const deductions =
          num(l.empBHXH) + num(l.empBHYT) + num(l.empBHTN) + num(l.pitAmount);
        rows.push({
          tenant_id: tenantId,
          year: run.year,
          month: run.month,
          employee_id: l.employeeId,
          department: depByEmployee.get(l.employeeId) ?? null,
          headcount: 1,
          gross_pay: num(l.grossSalary),
          net_pay: num(l.netSalary),
          deductions,
        });
      }
    }
    await this.duck.reloadTenantTable('fact_hr', tenantId, rows, [
      'tenant_id',
      'year',
      'month',
      'employee_id',
      'department',
      'headcount',
      'gross_pay',
      'net_pay',
      'deductions',
    ]);
  }
}
