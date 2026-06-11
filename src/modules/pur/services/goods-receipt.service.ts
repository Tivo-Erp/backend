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
import { GOODS_RECEIPT_FIELD_CONFIG } from '../config/goods-receipt.field-config.js';
import {
  CreateGoodsReceiptDto,
  CreateGRNLineDto,
  GoodsReceiptQueryDto,
} from '../dto/goods-receipt.dto.js';

const RECEIVABLE_STATUSES = [
  'approved',
  'sent_to_supplier',
  'partial_received',
];

const GRN_SORTABLE_FIELDS = ['createdAt', 'grnNumber', 'receiptDate'] as const;

@Injectable()
export class GoodsReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  // ── PUR-003: Create GRN with inventory impact ─────────────────

  async create(tenantId: string, userId: string, dto: CreateGoodsReceiptDto) {
    // Reject duplicate PO line references before any writes.
    const poLineIds = dto.lines.map((l) => l.poLineId);
    if (new Set(poLineIds).size !== poLineIds.length) {
      throw new BadRequestException('PUR_GRN_DUPLICATE_PO_LINE');
    }

    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: dto.poId, tenantId, deletedAt: null },
        include: { lines: true },
      });
      if (!po) throw new NotFoundException('PUR_PO_NOT_FOUND');
      if (!RECEIVABLE_STATUSES.includes(po.status)) {
        throw new ConflictException('PUR_PO_NOT_RECEIVABLE');
      }

      // Warehouse must exist, be active and belong to this tenant.
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      // Every referenced bin must belong (via its zone) to the GRN warehouse.
      const distinctBinIds = [
        ...new Set(dto.lines.map((l) => l.binId).filter(Boolean)),
      ] as string[];
      for (const binId of distinctBinIds) {
        const bin = await tx.bin.findFirst({
          where: { id: binId, zone: { warehouseId: dto.warehouseId } },
          select: { id: true },
        });
        if (!bin) {
          throw new BadRequestException(`WMS_BIN_NOT_IN_WAREHOUSE: ${binId}`);
        }
      }

      const lineById = new Map(po.lines.map((l) => [l.id, l]));
      const grnLines: any[] = [];

      for (const line of dto.lines) {
        const poLine = lineById.get(line.poLineId);
        if (!poLine)
          throw new NotFoundException(
            `PUR_PO_LINE_NOT_FOUND: ${line.poLineId}`,
          );

        const receivedQty = new Prisma.Decimal(line.receivedQty);
        const ordered = new Prisma.Decimal(poLine.quantity);
        const alreadyReceived = new Prisma.Decimal(poLine.receivedQty);
        const remaining = ordered.sub(alreadyReceived);

        // Fast-fail on stale data; the guarded update below is authoritative.
        if (receivedQty.gt(remaining)) {
          throw new BadRequestException(
            `PUR_GRN_EXCEEDS_PO_QTY: line ${line.poLineId} remaining ${remaining.toString()}, received ${receivedQty.toString()}`,
          );
        }

        const item = await tx.item.findFirst({
          where: { id: poLine.itemId, tenantId, deletedAt: null },
          select: { id: true, isBatchTracked: true },
        });
        if (!item)
          throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${poLine.itemId}`);

        const lotId = await this.resolveLot(tx, tenantId, poLine, line, item);

        // Guarded conditional update — prevents concurrent over-receipt:
        // only increments when currentReceived <= ordered - receivedQty.
        const { count } = await tx.purchaseOrderLine.updateMany({
          where: {
            id: poLine.id,
            poId: po.id,
            receivedQty: { lte: ordered.sub(receivedQty) },
          },
          data: { receivedQty: { increment: receivedQty } },
        });
        if (count === 0) {
          throw new BadRequestException(
            `PUR_GRN_EXCEEDS_PO_QTY: line ${line.poLineId}`,
          );
        }

        // Upsert inventory balance
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: poLine.itemId,
            warehouseId: dto.warehouseId,
            variantId: poLine.variantId ?? null,
            binId: line.binId ?? null,
            lotId,
          },
        });

        if (balance) {
          await tx.inventoryBalance.update({
            where: { id: balance.id },
            data: {
              quantityOnHand: { increment: receivedQty },
              costPerUnit: poLine.unitPrice,
            },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              tenantId,
              itemId: poLine.itemId,
              warehouseId: dto.warehouseId,
              variantId: poLine.variantId ?? null,
              binId: line.binId ?? null,
              lotId,
              quantityOnHand: receivedQty,
              costPerUnit: poLine.unitPrice,
              uom: poLine.uom,
            },
          });
        }

        await tx.stockMovement.create({
          data: {
            tenantId,
            itemId: poLine.itemId,
            warehouseId: dto.warehouseId,
            movementType: 'grn_receipt',
            direction: 'IN',
            quantity: receivedQty,
            uom: poLine.uom,
            costPerUnit: poLine.unitPrice,
            referenceType: 'PurchaseOrder',
            referenceId: po.id,
            binId: line.binId ?? null,
            lotId,
            notes: dto.notes ?? null,
            createdBy: userId,
          },
        });

        grnLines.push({
          poLineId: poLine.id,
          itemId: poLine.itemId,
          receivedQty,
          binId: line.binId ?? null,
          lotId,
          uom: poLine.uom,
        });
      }

      const grnNumber = await this.sequences.getNextNumber(
        tenantId,
        'GRN',
        undefined,
        tx,
      );

      const grn = await tx.goodsReceipt.create({
        data: {
          tenantId,
          grnNumber,
          poId: po.id,
          warehouseId: dto.warehouseId,
          receiptDate: dto.receiptDate ? new Date(dto.receiptDate) : undefined,
          notes: dto.notes ?? null,
          createdBy: userId,
          lines: { create: grnLines },
        },
        include: { lines: true },
      });

      // Recompute PO status from updated received quantities
      const refreshed = await tx.purchaseOrderLine.findMany({
        where: { poId: po.id },
      });
      const fullyReceived = refreshed.every((l) =>
        new Prisma.Decimal(l.receivedQty).gte(new Prisma.Decimal(l.quantity)),
      );
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: fullyReceived ? 'fully_received' : 'partial_received' },
      });

      return grn;
    });
  }

  /**
   * Resolves (creates or reuses) the lot for a batch-tracked item.
   * A pre-existing lot number must belong to the same item and be active.
   */
  private async resolveLot(
    tx: any,
    tenantId: string,
    poLine: { itemId: string },
    line: CreateGRNLineDto,
    item: { isBatchTracked: boolean },
  ): Promise<string | null> {
    if (!item.isBatchTracked) return null;

    if (!line.lotNumber) {
      throw new BadRequestException(
        `INV_LOT_REQUIRED: item ${poLine.itemId} is batch-tracked`,
      );
    }

    const existing = await tx.lot.findUnique({
      where: { tenantId_lotNumber: { tenantId, lotNumber: line.lotNumber } },
    });

    if (existing) {
      if (existing.itemId !== poLine.itemId) {
        throw new ConflictException(
          `INV_LOT_ITEM_MISMATCH: lot ${line.lotNumber} belongs to another item`,
        );
      }
      if (existing.status !== 'active') {
        throw new ConflictException(`INV_LOT_INACTIVE: ${line.lotNumber}`);
      }
      if (line.expiryDate) {
        await tx.lot.update({
          where: { id: existing.id },
          data: { expiryDate: new Date(line.expiryDate) },
        });
      }
      return existing.id;
    }

    const created = await tx.lot.create({
      data: {
        tenantId,
        lotNumber: line.lotNumber,
        itemId: poLine.itemId,
        expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
      },
    });
    return created.id;
  }

  async findAll(
    tenantId: string,
    query: GoodsReceiptQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      GOODS_RECEIPT_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      poId,
      warehouseId,
    } = query;
    const sortBy = safeSortBy(query.sortBy, GRN_SORTABLE_FIELDS);
    const where: any = {
      tenantId,
      ...(poId && { poId }),
      ...(warehouseId && { warehouseId }),
    };

    const [data, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.goodsReceipt.count({ where }),
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
      GOODS_RECEIPT_FIELD_CONFIG,
    );
    const grn = await this.prisma.goodsReceipt.findFirst({
      where: { id, tenantId },
      select: { ...select, lines: true },
    });
    if (!grn) throw new NotFoundException('PUR_GRN_NOT_FOUND');
    return grn;
  }
}
