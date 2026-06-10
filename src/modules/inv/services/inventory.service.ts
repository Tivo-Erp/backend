import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { BALANCE_FIELD_CONFIG } from '../config/balance.field-config.js';
import { MOVEMENT_FIELD_CONFIG } from '../config/movement.field-config.js';
import {
  InventoryQueryDto,
  MovementQueryDto,
  CreateStockAdjustmentDto,
  CreateStockTransferDto,
} from '../dto/inv.dto.js';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ── INV-001: Stock Balance Query ──────────────────────────────

  async findBalances(tenantId: string, query: InventoryQueryDto, userRoles: string[]) {
    const {
      page = 1, limit = 20, sortBy = 'updatedAt', sortOrder = 'desc',
      warehouseId, itemId, search, belowRop, includeZero,
    } = query;

    // Build allowed response fields from role config
    const allowedFields = FieldSelector.resolveAllowedFields(userRoles, BALANCE_FIELD_CONFIG);

    const where: any = {
      tenantId,
      ...(warehouseId && { warehouseId }),
      ...(itemId && { itemId }),
      ...(!includeZero && { quantityOnHand: { gt: 0 } }),
    };

    if (search) {
      where.item = {
        OR: [
          { sku: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    // belowRop requires computing available vs minStockLevel — must include items with minStockLevel set
    if (belowRop) {
      where.item = {
        ...(where.item ?? {}),
        minStockLevel: { not: null },
      };
    }

    const orderBy = { [sortBy]: sortOrder };

    let data: any[];
    let total: number;

    if (belowRop) {
      // Fetch all matching records (no pagination) to compute belowRop correctly, then paginate in-memory
      const all = await this.prisma.inventoryBalance.findMany({
        where,
        include: {
          item: { select: { sku: true, name: true, minStockLevel: true } },
          warehouse: { select: { code: true } },
        },
        orderBy,
      });

      const filtered = all
        .map((b) => this.mapBalance(b, allowedFields))
        .filter((b) => b.isBelowRop);

      total = filtered.length;
      data = filtered.slice((page - 1) * limit, page * limit);
    } else {
      const [raw, count] = await Promise.all([
        this.prisma.inventoryBalance.findMany({
          where,
          include: {
            item: { select: { sku: true, name: true, minStockLevel: true } },
            warehouse: { select: { code: true } },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy,
        }),
        this.prisma.inventoryBalance.count({ where }),
      ]);

      total = count;
      data = raw.map((b) => this.mapBalance(b, allowedFields));
    }

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  private mapBalance(b: any, allowedFields: Set<string>) {
    const available = Number(b.quantityOnHand) - Number(b.quantityReserved);
    const isBelowRop = b.item.minStockLevel
      ? available < Number(b.item.minStockLevel)
      : false;

    const full = {
      itemId: b.itemId,
      itemSku: b.item.sku,
      itemName: b.item.name,
      warehouseId: b.warehouseId,
      warehouseCode: b.warehouse.code,
      quantityOnHand: Number(b.quantityOnHand),
      quantityReserved: Number(b.quantityReserved),
      quantityAvailable: available,
      uom: b.uom,
      costPerUnit: Number(b.costPerUnit),
      totalValue: available * Number(b.costPerUnit),
      minStockLevel: b.item.minStockLevel ? Number(b.item.minStockLevel) : undefined,
      isBelowRop,
      binLabel: b.bin?.label ?? undefined,
      lotNumber: b.lot?.lotNumber ?? undefined,
    };

    // Filter response to allowed fields
    return Object.fromEntries(
      Object.entries(full).filter(([k]) => allowedFields.has(k)),
    );
  }

  // ── INV-001: Movement History ─────────────────────────────────

  async findMovements(
    tenantId: string,
    query: MovementQueryDto,
    userRoles: string[],
    fields?: string,
  ) {
    const {
      page = 1, limit = 20,
      itemId, warehouseId, movementType, dateFrom, dateTo,
    } = query;

    const select = FieldSelector.buildPrismaSelect(fields, userRoles, MOVEMENT_FIELD_CONFIG);

    const where: any = {
      tenantId,
      ...(itemId && { itemId }),
      ...(warehouseId && { warehouseId }),
      ...(movementType && { movementType }),
      ...((dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + 'T23:59:59Z') }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  // ── INV-002: Stock Adjustment ─────────────────────────────────

  async createAdjustment(tenantId: string, userId: string, dto: CreateStockAdjustmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
      if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      for (const line of dto.lines) {
        const item = await tx.item.findFirst({
          where: { id: line.itemId, tenantId, deletedAt: null },
          select: { id: true, isBatchTracked: true },
        });
        if (!item) throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${line.itemId}`);

        if (item.isBatchTracked && !line.lotId) {
          throw new BadRequestException(`INV_LOT_REQUIRED: item ${line.itemId} is batch-tracked`);
        }

        const current = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.warehouseId,
            variantId: null,
            binId: line.binId ?? null,
            lotId: line.lotId ?? null,
          },
        });

        const currentQty = current ? Number(current.quantityOnHand) : 0;
        const newQty = currentQty + line.adjustmentQty;

        if (newQty < 0) {
          throw new BadRequestException(
            `INV_STOCK_NEGATIVE: item ${line.itemId} would go below zero (current: ${currentQty}, adj: ${line.adjustmentQty})`,
          );
        }

        if (current) {
          await tx.inventoryBalance.update({
            where: { id: current.id },
            data: {
              quantityOnHand: newQty,
              ...(line.costPerUnit !== undefined && { costPerUnit: line.costPerUnit }),
            },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              tenantId,
              itemId: line.itemId,
              warehouseId: dto.warehouseId,
              variantId: null,
              binId: line.binId ?? null,
              lotId: line.lotId ?? null,
              quantityOnHand: newQty,
              costPerUnit: line.costPerUnit ?? 0,
              uom: line.uom,
            },
          });
        }

        await tx.stockMovement.create({
          data: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.warehouseId,
            movementType: 'adjustment',
            direction: line.adjustmentQty >= 0 ? 'IN' : 'OUT',
            quantity: Math.abs(line.adjustmentQty),
            uom: line.uom,
            costPerUnit: line.costPerUnit ?? null,
            binId: line.binId ?? null,
            lotId: line.lotId ?? null,
            notes: dto.notes ?? null,
            createdBy: userId,
          },
        });
      }

      return { success: true, linesProcessed: dto.lines.length };
    });
  }

  // ── INV-003: Stock Transfer ───────────────────────────────────

  async createTransfer(tenantId: string, userId: string, dto: CreateStockTransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('WMS_TRANSFER_SAME_WAREHOUSE');
    }

    return this.prisma.$transaction(async (tx) => {
      const [fromWh, toWh] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: dto.fromWarehouseId, tenantId } }),
        tx.warehouse.findFirst({ where: { id: dto.toWarehouseId, tenantId } }),
      ]);
      if (!fromWh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND: fromWarehouseId');
      if (!toWh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND: toWarehouseId');

      for (const line of dto.lines) {
        const srcBalance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.fromWarehouseId,
            binId: line.fromBinId ?? null,
            lotId: line.lotId ?? null,
          },
        });

        const available = srcBalance
          ? Number(srcBalance.quantityOnHand) - Number(srcBalance.quantityReserved)
          : 0;

        if (available < line.quantity) {
          throw new BadRequestException(
            `INV_STOCK_INSUFFICIENT: item ${line.itemId} available ${available}, requested ${line.quantity}`,
          );
        }

        // Decrease source: decrement onHand and release reserved proportionally
        await tx.inventoryBalance.update({
          where: { id: srcBalance!.id },
          data: {
            quantityOnHand: { decrement: line.quantity },
            // Release reserved that was covering this transfer qty (capped at reserved amount)
            quantityReserved: {
              decrement: Math.min(
                line.quantity,
                Number(srcBalance!.quantityReserved),
              ),
            },
          },
        });

        // Upsert destination — propagate variantId from source
        const destBalance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.toWarehouseId,
            variantId: srcBalance!.variantId ?? null,
            binId: line.toBinId ?? null,
            lotId: line.lotId ?? null,
          },
        });

        if (destBalance) {
          await tx.inventoryBalance.update({
            where: { id: destBalance.id },
            data: { quantityOnHand: { increment: line.quantity } },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              tenantId,
              itemId: line.itemId,
              warehouseId: dto.toWarehouseId,
              variantId: srcBalance!.variantId ?? null,
              binId: line.toBinId ?? null,
              lotId: line.lotId ?? null,
              quantityOnHand: line.quantity,
              costPerUnit: srcBalance!.costPerUnit ?? 0,
              uom: line.uom,
            },
          });
        }

        // 2 movements per line: transfer_out (source) + transfer_in (dest)
        await tx.stockMovement.createMany({
          data: [
            {
              tenantId,
              itemId: line.itemId,
              warehouseId: dto.fromWarehouseId,
              movementType: 'transfer_out',
              direction: 'OUT',
              quantity: line.quantity,
              uom: line.uom,
              binId: line.fromBinId ?? null,
              lotId: line.lotId ?? null,
              notes: dto.notes ?? null,
              createdBy: userId,
            },
            {
              tenantId,
              itemId: line.itemId,
              warehouseId: dto.toWarehouseId,
              movementType: 'transfer_in',
              direction: 'IN',
              quantity: line.quantity,
              uom: line.uom,
              binId: line.toBinId ?? null,
              lotId: line.lotId ?? null,
              notes: dto.notes ?? null,
              createdBy: userId,
            },
          ],
        });
      }

      return {
        success: true,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        linesTransferred: dto.lines.length,
      };
    });
  }
}
