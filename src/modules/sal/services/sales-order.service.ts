import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { OutboxService } from '../../../infra/events/outbox.service.js';
import { EVENT } from '../../../infra/events/event-catalog.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { SALES_ORDER_FIELD_CONFIG } from '../config/sales-order.field-config.js';
import {
  CreateSalesOrderDto,
  CreateSOLineDto,
  SalesOrderQueryDto,
} from '../dto/sales-order.dto.js';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Columns the client may sort by — anything else falls back to createdAt. */
const SO_SORTABLE_FIELDS = [
  'soNumber',
  'status',
  'orderDate',
  'deliveryDate',
  'grandTotal',
  'createdAt',
  'updatedAt',
] as const;

/** Statuses from which an SO can be cancelled. */
const CANCELLABLE_STATUSES = [
  'draft',
  'confirmed',
  'pending_approval',
  'approved',
] as const;

/** Statuses in which stock has been reserved (during confirm). */
const RESERVED_STATUSES = ['confirmed', 'pending_approval', 'approved'];

@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
    private readonly outbox: OutboxService,
  ) {}

  // ── SAL-001: Create SO ────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateSalesOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customerId, tenantId },
        select: { id: true, isActive: true },
      });
      if (!customer || !customer.isActive)
        throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');

      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId },
        select: { id: true, isActive: true },
      });
      if (!warehouse || !warehouse.isActive)
        throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      if (dto.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: dto.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw new NotFoundException('ORG_BRANCH_NOT_FOUND');
      }

      const computed = await this.computeLines(tx, tenantId, dto.lines);
      const subTotal = computed
        .reduce((s, l) => s.plus(l.lineTotal), ZERO)
        .toDecimalPlaces(2);
      const taxAmount = computed
        .reduce((s, l) => s.plus(l.taxAmount), ZERO)
        .toDecimalPlaces(2);
      const grandTotal = subTotal.plus(taxAmount).toDecimalPlaces(2);

      const soNumber = await this.sequences.getNextNumber(
        tenantId,
        'SO',
        undefined,
        tx,
      );

      return tx.salesOrder.create({
        data: {
          tenantId,
          soNumber,
          customerId: dto.customerId,
          warehouseId: dto.warehouseId,
          branchId: dto.branchId ?? null,
          status: 'draft',
          deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          currency: 'VND',
          subTotal,
          taxAmount,
          grandTotal,
          notes: dto.notes ?? null,
          createdBy: userId,
          lines: {
            create: computed.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
              uom: l.uom,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              taxRateId: l.taxRateId,
              taxRate: l.taxRate,
              lineTotal: l.lineTotal,
              sortOrder: l.sortOrder,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  private async computeLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: CreateSOLineDto[],
  ) {
    const result = [];
    let sortOrder = 0;

    for (const line of lines) {
      const item = await tx.item.findFirst({
        where: { id: line.itemId, tenantId, deletedAt: null },
        select: { id: true, isSellable: true },
      });
      if (!item)
        throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${line.itemId}`);
      if (!item.isSellable)
        throw new BadRequestException(`MAT_ITEM_NOT_SELLABLE: ${line.itemId}`);

      // All money math in Prisma.Decimal — float arithmetic must never touch
      // monetary values (0.1 + 0.2 !== 0.3).
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      const discountPct = new Prisma.Decimal(line.discountPct ?? 0);
      // TODO(tax-master): taxRate is client-supplied because no TaxRate master
      // exists yet. Once a TaxRate model lands, derive the rate server-side
      // from taxRateId and reject client-supplied values.
      const taxRate = new Prisma.Decimal(line.taxRate ?? 0);

      const lineTotal = quantity
        .mul(unitPrice)
        .mul(HUNDRED.minus(discountPct))
        .div(HUNDRED)
        .toDecimalPlaces(2);
      const taxAmount = lineTotal.mul(taxRate).div(HUNDRED).toDecimalPlaces(2);

      result.push({
        itemId: line.itemId,
        quantity,
        uom: line.uom,
        unitPrice,
        discountPct,
        taxRateId: line.taxRateId ?? null,
        taxRate,
        lineTotal,
        taxAmount,
        sortOrder: sortOrder++,
      });
    }

    return result;
  }

  // ── SAL-001: Confirm with credit check + stock reservation ────

  async confirm(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { lines: true },
      });
      if (!so) throw new NotFoundException('SAL_SO_NOT_FOUND');

      // Claim the SO with a guarded conditional update: only one concurrent
      // confirm can flip draft → approved, so double-confirm (and therefore
      // double reservation / double credit) is impossible. Any compensation
      // below happens inside this transaction, so a failure rolls the flip back.
      const claimed = await tx.salesOrder.updateMany({
        where: { id, tenantId, status: 'draft', deletedAt: null },
        data: { status: 'approved' },
      });
      if (claimed.count === 0) throw new ConflictException('SAL_SO_NOT_DRAFT');

      // Re-check the customer is still active at confirm time.
      const customer = await tx.customer.findFirst({
        where: { id: so.customerId, tenantId, isActive: true },
        select: { id: true, creditLimit: true, creditUsed: true },
      });
      if (!customer) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');

      // Check + reserve stock (warehouse-level, greedy across balance rows).
      // Each increment is a guarded conditional update; a lost race throws and
      // rolls back the whole transaction, including the status flip above.
      for (const line of so.lines) {
        await this.reserveStock(
          tx,
          tenantId,
          so.warehouseId,
          line.itemId,
          new Prisma.Decimal(line.quantity),
        );
      }

      // Credit check — atomic via conditional update so two concurrent orders
      // cannot both pass the limit. creditLimit = 0 means UNLIMITED credit
      // (documented contract — see CreateCustomerDto.creditLimit).
      const grandTotal = new Prisma.Decimal(so.grandTotal);
      const creditLimit = new Prisma.Decimal(customer.creditLimit);
      let confirmed = true;

      if (creditLimit.lte(0)) {
        // Unlimited credit — plain increment, never goes pending_approval.
        await tx.customer.updateMany({
          where: { id: customer.id, tenantId },
          data: { creditUsed: { increment: grandTotal } },
        });
      } else {
        // Apply credit only if creditUsed + grandTotal <= creditLimit, i.e.
        // creditUsed <= creditLimit - grandTotal, evaluated atomically in the DB.
        const applied = await tx.customer.updateMany({
          where: {
            id: customer.id,
            tenantId,
            creditUsed: { lte: creditLimit.minus(grandTotal) },
          },
          data: { creditUsed: { increment: grandTotal } },
        });
        if (applied.count === 0) {
          // Over limit: no credit applied; downgrade our claim to
          // pending_approval (we own the row since the guarded claim above).
          await tx.salesOrder.update({
            where: { id },
            data: { status: 'pending_approval' },
          });
          confirmed = false;
        }
      }

      // INF-002: emit sales.so.confirmed atomically with the status flip —
      // only when the order really confirmed (not downgraded to
      // pending_approval by the credit check).
      if (confirmed) {
        await this.outbox.record(tx, {
          tenantId,
          aggregateType: 'sales_order',
          aggregateId: so.id,
          eventType: EVENT.SO_CONFIRMED,
          payload: {
            soNumber: so.soNumber,
            customerId: so.customerId,
            warehouseId: so.warehouseId,
            grandTotal: so.grandTotal.toString(),
            currency: so.currency,
          },
        });
      }

      return tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  private async reserveStock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    itemId: string,
    qty: Prisma.Decimal,
  ) {
    const balances = await tx.inventoryBalance.findMany({
      where: { tenantId, itemId, warehouseId },
      orderBy: { quantityOnHand: 'desc' },
    });

    // Fast-fail availability pre-check (the guarded updates below are the
    // authoritative race-safe check).
    const totalAvailable = balances.reduce(
      (s, b) =>
        s.plus(new Prisma.Decimal(b.quantityOnHand).minus(b.quantityReserved)),
      ZERO,
    );
    if (totalAvailable.lt(qty)) {
      throw new BadRequestException(
        `INV_STOCK_INSUFFICIENT: item ${itemId} available ${totalAvailable.toString()}, requested ${qty.toString()}`,
      );
    }

    let remaining = qty;
    for (const b of balances) {
      if (remaining.lte(0)) break;
      const onHand = new Prisma.Decimal(b.quantityOnHand);
      const reserved = new Prisma.Decimal(b.quantityReserved);
      const free = onHand.minus(reserved);
      if (free.lte(0)) continue;
      const take = Prisma.Decimal.min(free, remaining);

      // Guarded increment: only applies while
      // quantityOnHand - take >= quantityReserved (bound computed from the
      // freshly-read row). A concurrent reservation that consumed the slack
      // makes count 0 → insufficient stock → whole transaction rolls back.
      const updated = await tx.inventoryBalance.updateMany({
        where: { id: b.id, quantityReserved: { lte: onHand.minus(take) } },
        data: { quantityReserved: { increment: take } },
      });
      if (updated.count === 0) {
        throw new BadRequestException(
          `INV_STOCK_INSUFFICIENT: item ${itemId} reservation lost to a concurrent order`,
        );
      }
      remaining = remaining.minus(take);
    }

    if (remaining.gt(0)) {
      throw new BadRequestException(
        `INV_STOCK_INSUFFICIENT: item ${itemId} requested ${qty.toString()}`,
      );
    }
  }

  // ── SAL-001: Approve (manager override of credit hold) ────────

  async approve(tenantId: string, id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, customerId: true, grandTotal: true },
      });
      if (!so) throw new NotFoundException('SAL_SO_NOT_FOUND');

      // Race-safe claim: only one concurrent approve can flip the status.
      const claimed = await tx.salesOrder.updateMany({
        where: { id, tenantId, status: 'pending_approval', deletedAt: null },
        data: {
          status: 'approved',
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });
      if (claimed.count === 0)
        throw new ConflictException('SAL_SO_NOT_PENDING');

      // Approval is the manager override of the credit hold — apply credit
      // with a plain increment (no limit re-check), tenant-scoped.
      await tx.customer.updateMany({
        where: { id: so.customerId, tenantId },
        data: { creditUsed: { increment: new Prisma.Decimal(so.grandTotal) } },
      });

      return tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  // ── SAL-001: Cancel (releases reservations + credit) ──────────

  async cancel(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Read BEFORE the claim — updateMany cannot return the previous status,
      // and the compensations below depend on it. The claim's where includes
      // the previous status, so a concurrent transition makes the claim fail.
      const so = await tx.salesOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { lines: true },
      });
      if (!so) throw new NotFoundException('SAL_SO_NOT_FOUND');

      if (!(CANCELLABLE_STATUSES as readonly string[]).includes(so.status))
        throw new ConflictException('SAL_SO_NOT_CANCELLABLE');

      if (so.lines.some((l) => new Prisma.Decimal(l.shippedQty).gt(0)))
        throw new ConflictException('SAL_SO_ALREADY_SHIPPED');

      // Race-safe claim pinned to the previous status we just observed.
      const claimed = await tx.salesOrder.updateMany({
        where: { id, tenantId, status: so.status, deletedAt: null },
        data: { status: 'cancelled' },
      });
      if (claimed.count === 0)
        throw new ConflictException('SAL_SO_NOT_CANCELLABLE');

      // Stock was reserved during confirm — release it. Draft cancel is a
      // pure status flip (nothing was reserved, no credit applied).
      if (RESERVED_STATUSES.includes(so.status)) {
        for (const line of so.lines) {
          await this.releaseStock(
            tx,
            tenantId,
            so.warehouseId,
            line.itemId,
            new Prisma.Decimal(line.quantity),
          );
        }
      }

      // Credit was applied only once the SO reached 'approved'.
      if (so.status === 'approved') {
        const grandTotal = new Prisma.Decimal(so.grandTotal);
        const released = await tx.customer.updateMany({
          where: {
            id: so.customerId,
            tenantId,
            creditUsed: { gte: grandTotal },
          },
          data: { creditUsed: { decrement: grandTotal } },
        });
        if (released.count === 0) {
          // creditUsed < grandTotal (e.g. partially compensated elsewhere) —
          // clamp to 0 for safety, never let it go negative.
          await tx.customer.updateMany({
            where: { id: so.customerId, tenantId },
            data: { creditUsed: 0 },
          });
        }
      }

      return tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  /**
   * Releases a reservation greedily across the item/warehouse balance rows.
   * Each decrement is guarded with `quantityReserved >= take`, so a concurrent
   * consumer can never drive the reservation negative.
   */
  private async releaseStock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    itemId: string,
    qty: Prisma.Decimal,
  ) {
    const balances = await tx.inventoryBalance.findMany({
      where: { tenantId, itemId, warehouseId, quantityReserved: { gt: 0 } },
      orderBy: { quantityReserved: 'desc' },
    });

    let remaining = qty;
    for (const b of balances) {
      if (remaining.lte(0)) break;
      const reserved = new Prisma.Decimal(b.quantityReserved);
      const take = Prisma.Decimal.min(reserved, remaining);
      if (take.lte(0)) continue;

      const updated = await tx.inventoryBalance.updateMany({
        where: { id: b.id, quantityReserved: { gte: take } },
        data: { quantityReserved: { decrement: take } },
      });
      if (updated.count > 0) remaining = remaining.minus(take);
    }
    // If remaining > 0 the reservation was already (partially) consumed — stop
    // silently rather than risking a negative quantityReserved.
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: SalesOrderQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      SALES_ORDER_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      customerId,
      warehouseId,
      status,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, SO_SORTABLE_FIELDS);

    const where: Prisma.SalesOrderWhereInput = {
      tenantId,
      deletedAt: null,
      ...(customerId && { customerId }),
      ...(warehouseId && { warehouseId }),
      ...(status && { status }),
      ...(search && { soNumber: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(
    tenantId: string,
    id: string,
    userRoles: string[],
    fields?: string,
  ) {
    const select = FieldSelector.buildPrismaSelect(
      fields,
      userRoles,
      SALES_ORDER_FIELD_CONFIG,
    );
    const so = await this.prisma.salesOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      // Field whitelist applies to the SO header; lines are always included
      // (consistent with create/confirm responses).
      select: { ...select, lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!so) throw new NotFoundException('SAL_SO_NOT_FOUND');
    return so;
  }
}
