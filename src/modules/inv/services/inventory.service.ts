import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/infra/database/prisma.service.js';
import { PaginatedResponseDto } from 'src/common/dto/pagination.dto.js';
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

  async findBalances(tenantId: string, query: InventoryQueryDto) {
    const {
      page = 1, limit = 20, sortBy = 'updatedAt', sortOrder = 'desc',
      warehouseId, itemId, search, belowRop, includeZero,
    } = query;
    const skip = (page - 1) * limit;

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

    const [raw, total] = await Promise.all([
      this.prisma.inventoryBalance.findMany({
        where,
        include: {
          item: { select: { sku: true, name: true, minStockLevel: true } },
          warehouse: { select: { code: true } },
        },
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.inventoryBalance.count({ where }),
    ]);

    const data = raw
      .map((b) => {
        const available = Number(b.quantityOnHand) - Number(b.quantityReserved);
        const isBelowRop = b.item.minStockLevel
          ? available < Number(b.item.minStockLevel)
          : false;
        return {
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
        };
      })
      .filter((b) => !belowRop || b.isBelowRop);

    return PaginatedResponseDto.create(data, total, page, limit);
  }

  // ── INV-001: Movement History ─────────────────────────────────

  async findMovements(tenantId: string, query: MovementQueryDto) {
    const {
      page = 1, limit = 20,
      itemId, warehouseId, movementType, dateFrom, dateTo,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      tenantId,
      ...(itemId && { itemId }),
      ...(warehouseId && { warehouseId }),
      ...(movementType && { movementType }),
      ...(dateFrom || dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo + 'T23:59:59Z') }),
        },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        select: {
          id: true, movementType: true, direction: true,
          quantity: true, uom: true, costPerUnit: true,
          referenceType: true, referenceId: true,
          notes: true, createdBy: true, createdAt: true,
        },
        skip,
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
      // Verify warehouse belongs to tenant
      const wh = await tx.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } });
      if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      const movements = [];

      for (const line of dto.lines) {
        const item = await tx.item.findFirst({
          where: { id: line.itemId, tenantId, deletedAt: null },
          select: { id: true, isBatchTracked: true },
        });
        if (!item) throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${line.itemId}`);

        // Batch-tracked items require lotId
        if (item.isBatchTracked && !line.lotId) {
          throw new BadRequestException(`INV_LOT_REQUIRED: item ${line.itemId} is batch-tracked`);
        }

        // Upsert balance
        const balanceKey = {
          tenantId_itemId_warehouseId_variantId_binId_lotId: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.warehouseId,
            variantId: null,
            binId: line.binId ?? null,
            lotId: line.lotId ?? null,
          },
        };

        const current = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.warehouseId,
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
              ...(line.costPerUnit && { costPerUnit: line.costPerUnit }),
            },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              tenantId,
              itemId: line.itemId,
              warehouseId: dto.warehouseId,
              binId: line.binId ?? null,
              lotId: line.lotId ?? null,
              quantityOnHand: newQty,
              costPerUnit: line.costPerUnit ?? 0,
              uom: line.uom,
            },
          });
        }

        movements.push(
          tx.stockMovement.create({
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
          }),
        );
      }

      await Promise.all(movements);
      return { success: true, linesProcessed: dto.lines.length };
    });
  }

  // ── INV-003: Stock Transfer ───────────────────────────────────

  async createTransfer(tenantId: string, userId: string, dto: CreateStockTransferDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('WMS_TRANSFER_SAME_WAREHOUSE');
    }

    return this.prisma.$transaction(async (tx) => {
      // Verify both warehouses belong to tenant
      const [fromWh, toWh] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: dto.fromWarehouseId, tenantId } }),
        tx.warehouse.findFirst({ where: { id: dto.toWarehouseId, tenantId } }),
      ]);
      if (!fromWh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND: fromWarehouseId');
      if (!toWh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND: toWarehouseId');

      for (const line of dto.lines) {
        // Check source stock
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

        // Decrease source
        await tx.inventoryBalance.update({
          where: { id: srcBalance!.id },
          data: { quantityOnHand: { decrement: line.quantity } },
        });

        // Upsert destination
        const destBalance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.toWarehouseId,
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
              binId: line.toBinId ?? null,
              lotId: line.lotId ?? null,
              quantityOnHand: line.quantity,
              costPerUnit: srcBalance?.costPerUnit ?? 0,
              uom: line.uom,
            },
          });
        }

        // Create 2 stock movements: transfer_out (source) + transfer_in (dest)
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
