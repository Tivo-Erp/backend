import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { PURCHASE_ORDER_FIELD_CONFIG } from '../config/purchase-order.field-config.js';
import {
  CreatePurchaseOrderDto,
  CreatePOLineDto,
  PurchaseOrderQueryDto,
  UpdatePurchaseOrderDto,
} from '../dto/purchase-order.dto.js';

const PO_SORTABLE_FIELDS = [
  'createdAt',
  'updatedAt',
  'poNumber',
  'status',
  'orderDate',
  'expectedDate',
  'grandTotal',
] as const;

/** Statuses from which a PO may transition to `cancelled`. */
const CANCELLABLE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent_to_supplier',
  'partial_received',
];

interface ComputedLine {
  itemId: string;
  description: string | null;
  quantity: Prisma.Decimal;
  uom: string;
  unitPrice: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxRateId: string | null;
  taxRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  sortOrder: number;
}

interface ComputedTotals {
  subTotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  // ── PUR-002: Create PO ────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const supplier = await this.requireActiveSupplier(
        tx,
        tenantId,
        dto.supplierId,
      );
      await this.requireActiveWarehouse(tx, tenantId, dto.warehouseId);
      if (dto.branchId) await this.requireBranch(tx, tenantId, dto.branchId);

      const computed = await this.computeLines(tx, tenantId, dto.lines);
      const totals = this.computeTotals(computed);

      const poNumber = await this.sequences.getNextNumber(
        tenantId,
        'PO',
        undefined,
        tx,
      );

      return tx.purchaseOrder.create({
        data: {
          tenantId,
          poNumber,
          supplierId: dto.supplierId,
          warehouseId: dto.warehouseId,
          branchId: dto.branchId ?? null,
          status: 'draft',
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          paymentTermsDays: dto.paymentTermsDays ?? supplier.paymentTermsDays,
          currency: dto.currency ?? 'VND',
          subTotal: totals.subTotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          grandTotal: totals.grandTotal,
          notes: dto.notes ?? null,
          createdBy: userId,
          lines: { create: computed.map((l) => this.toLineCreate(l)) },
        },
        include: { lines: true },
      });
    });
  }

  // ── PUR-002: Update PO (draft only) ───────────────────────────

  async update(
    tenantId: string,
    id: string,
    userId: string,
    dto: UpdatePurchaseOrderDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!po) throw new NotFoundException('PUR_PO_NOT_FOUND');
      if (po.status !== 'draft')
        throw new ConflictException('PUR_PO_NOT_DRAFT');

      if (dto.supplierId)
        await this.requireActiveSupplier(tx, tenantId, dto.supplierId);
      if (dto.warehouseId)
        await this.requireActiveWarehouse(tx, tenantId, dto.warehouseId);
      if (dto.branchId) await this.requireBranch(tx, tenantId, dto.branchId);

      const data: Prisma.PurchaseOrderUncheckedUpdateInput = {
        ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
        ...(dto.warehouseId !== undefined && { warehouseId: dto.warehouseId }),
        ...(dto.branchId !== undefined && { branchId: dto.branchId }),
        ...(dto.expectedDate !== undefined && {
          expectedDate: new Date(dto.expectedDate),
        }),
        ...(dto.paymentTermsDays !== undefined && {
          paymentTermsDays: dto.paymentTermsDays,
        }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updatedBy: userId,
      };

      if (dto.lines) {
        const computed = await this.computeLines(tx, tenantId, dto.lines);
        const totals = this.computeTotals(computed);
        await tx.purchaseOrderLine.deleteMany({ where: { poId: id } });
        data.lines = { create: computed.map((l) => this.toLineCreate(l)) };
        data.subTotal = totals.subTotal;
        data.discountAmount = totals.discountAmount;
        data.taxAmount = totals.taxAmount;
        data.grandTotal = totals.grandTotal;
      }

      return tx.purchaseOrder.update({
        where: { id },
        data,
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  // ── PUR-002: Soft delete (draft only) ─────────────────────────

  async remove(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!po) throw new NotFoundException('PUR_PO_NOT_FOUND');

      // Guarded write — status may have changed between read and write.
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, tenantId, status: 'draft', deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('PUR_PO_NOT_DRAFT');
    });
  }

  // ── Reference validations ─────────────────────────────────────

  private async requireActiveSupplier(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
  ) {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { id: true, isActive: true, paymentTermsDays: true },
    });
    if (!supplier || !supplier.isActive)
      throw new NotFoundException('PUR_SUPPLIER_NOT_FOUND');
    return supplier;
  }

  private async requireActiveWarehouse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
  ) {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
      select: { id: true, isActive: true },
    });
    if (!warehouse || !warehouse.isActive)
      throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');
    return warehouse;
  }

  private async requireBranch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ) {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('ORG_BRANCH_NOT_FOUND');
    return branch;
  }

  // ── Server-side totals (Decimal-safe) ─────────────────────────

  private toLineCreate(l: ComputedLine) {
    return {
      itemId: l.itemId,
      description: l.description,
      quantity: l.quantity,
      uom: l.uom,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      taxRateId: l.taxRateId,
      taxRate: l.taxRate,
      lineTotal: l.lineTotal,
      sortOrder: l.sortOrder,
    };
  }

  private computeTotals(computed: ComputedLine[]): ComputedTotals {
    const zero = new Prisma.Decimal(0);
    const subTotal = computed
      .reduce((s, l) => s.add(l.lineTotal), zero)
      .toDecimalPlaces(2);
    const discountAmount = computed
      .reduce((s, l) => s.add(l.discountAmount), zero)
      .toDecimalPlaces(2);
    const taxAmount = computed
      .reduce((s, l) => s.add(l.taxAmount), zero)
      .toDecimalPlaces(2);
    const grandTotal = subTotal.add(taxAmount).toDecimalPlaces(2);
    return { subTotal, discountAmount, taxAmount, grandTotal };
  }

  private async computeLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lines: CreatePOLineDto[],
  ): Promise<ComputedLine[]> {
    const result: ComputedLine[] = [];
    let sortOrder = 0;

    for (const line of lines) {
      const item = await tx.item.findFirst({
        where: { id: line.itemId, tenantId, deletedAt: null },
        select: { id: true, isPurchasable: true },
      });
      if (!item)
        throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${line.itemId}`);
      if (!item.isPurchasable)
        throw new BadRequestException(
          `MAT_ITEM_NOT_PURCHASABLE: ${line.itemId}`,
        );

      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unitPrice);
      const discountPct = new Prisma.Decimal(line.discountPct ?? 0);
      const taxRate = new Prisma.Decimal(line.taxRate ?? 0);

      const gross = quantity.mul(unitPrice);
      const discountAmount = gross.mul(discountPct).div(100).toDecimalPlaces(2);
      const lineTotal = gross
        .mul(new Prisma.Decimal(1).sub(discountPct.div(100)))
        .toDecimalPlaces(2);
      const taxAmount = lineTotal.mul(taxRate).div(100).toDecimalPlaces(2);

      result.push({
        itemId: line.itemId,
        description: line.description ?? null,
        quantity,
        uom: line.uom,
        unitPrice,
        discountPct,
        discountAmount,
        taxRateId: line.taxRateId ?? null,
        taxRate,
        lineTotal,
        taxAmount,
        sortOrder: sortOrder++,
      });
    }

    return result;
  }

  // ── PUR-002: Queries ──────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: PurchaseOrderQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      PURCHASE_ORDER_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      supplierId,
      warehouseId,
      status,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, PO_SORTABLE_FIELDS);

    const where: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      deletedAt: null,
      ...(supplierId && { supplierId }),
      ...(warehouseId && { warehouseId }),
      ...(status && { status }),
      ...(search && { poNumber: { contains: search, mode: 'insensitive' } }),
    };
    const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy,
      }),
      this.prisma.purchaseOrder.count({ where }),
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
      PURCHASE_ORDER_FIELD_CONFIG,
    );
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { ...select, lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!po) throw new NotFoundException('PUR_PO_NOT_FOUND');
    return po;
  }

  // ── PUR-002: State machine ────────────────────────────────────

  async submit(tenantId: string, id: string) {
    const po = await this.requirePo(tenantId, id);
    if (po.status !== 'draft') throw new ConflictException('PUR_PO_NOT_DRAFT');
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'pending_approval' },
    });
  }

  async approve(tenantId: string, id: string, userId: string) {
    const po = await this.requirePo(tenantId, id);
    if (po.status !== 'pending_approval')
      throw new ConflictException('PUR_PO_NOT_PENDING');
    return this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'approved', approvedBy: userId, approvedAt: new Date() },
    });
  }

  async cancel(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!po) throw new NotFoundException('PUR_PO_NOT_FOUND');
      if (!CANCELLABLE_STATUSES.includes(po.status)) {
        throw new ConflictException('PUR_PO_NOT_CANCELLABLE');
      }
      const grnCount = await tx.goodsReceipt.count({
        where: { tenantId, poId: id },
      });
      if (grnCount > 0) throw new ConflictException('PUR_PO_HAS_GRN');

      // Guarded write — status may have changed since the read above.
      const { count } = await tx.purchaseOrder.updateMany({
        where: {
          id,
          tenantId,
          status: { in: CANCELLABLE_STATUSES },
          deletedAt: null,
        },
        data: { status: 'cancelled' },
      });
      if (count === 0) throw new ConflictException('PUR_PO_NOT_CANCELLABLE');

      return tx.purchaseOrder.findFirst({ where: { id, tenantId } });
    });
  }

  private async requirePo(tenantId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!po) throw new NotFoundException('PUR_PO_NOT_FOUND');
    return po;
  }
}
