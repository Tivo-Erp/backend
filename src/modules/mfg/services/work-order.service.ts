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
import { WORK_ORDER_FIELD_CONFIG } from '../config/work-order.field-config.js';
import {
  CreateWorkOrderDto,
  ReportMaterialConsumptionDto,
  ReportOutputDto,
  UpdateWorkOrderDto,
  WorkOrderQueryDto,
} from '../dto/work-order.dto.js';

const WO_SORTABLE = [
  'createdAt',
  'updatedAt',
  'woNumber',
  'status',
  'plannedStartDate',
  'plannedEndDate',
  'priority',
] as const;

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

/** Statuses that may consume materials / report output. */
const EXECUTABLE_STATUSES = ['released', 'in_progress'];
const CANCELLABLE_STATUSES = ['draft', 'planned', 'released'];

@Injectable()
export class WorkOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
  ) {}

  // ── Create ────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateWorkOrderDto) {
    const start = new Date(dto.plannedStartDate);
    const end = new Date(dto.plannedEndDate);
    if (end < start) throw new BadRequestException('MFG_WO_END_BEFORE_START');

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.findFirst({
        where: { id: dto.itemId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');

      const bom = await tx.bOM.findFirst({
        where: { id: dto.bomId, tenantId },
        select: { id: true, itemId: true, isActive: true },
      });
      if (!bom) throw new NotFoundException('MFG_BOM_NOT_FOUND');
      if (bom.itemId !== dto.itemId)
        throw new BadRequestException('MFG_BOM_ITEM_MISMATCH');
      if (!bom.isActive) throw new ConflictException('MFG_BOM_INACTIVE');

      const wh = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      const woNumber = await this.sequences.getNextNumber(
        tenantId,
        'WO',
        undefined,
        tx,
      );

      return tx.workOrder.create({
        data: {
          tenantId,
          woNumber,
          itemId: dto.itemId,
          bomId: dto.bomId,
          warehouseId: dto.warehouseId,
          plannedQty: dec(dto.plannedQty),
          uom: dto.uom,
          status: 'draft',
          plannedStartDate: start,
          plannedEndDate: end,
          priority: dto.priority ?? 5,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });
    });
  }

  // ── Update (draft only) ───────────────────────────────────────

  async update(tenantId: string, id: string, dto: UpdateWorkOrderDto) {
    const wo = await this.requireWo(tenantId, id);
    if (wo.status !== 'draft') throw new ConflictException('MFG_WO_NOT_DRAFT');

    if (dto.bomId) {
      const bom = await this.prisma.bOM.findFirst({
        where: { id: dto.bomId, tenantId },
        select: { id: true, itemId: true, isActive: true },
      });
      if (!bom) throw new NotFoundException('MFG_BOM_NOT_FOUND');
      if (bom.itemId !== wo.itemId)
        throw new BadRequestException('MFG_BOM_ITEM_MISMATCH');
      if (!bom.isActive) throw new ConflictException('MFG_BOM_INACTIVE');
    }

    const start = dto.plannedStartDate
      ? new Date(dto.plannedStartDate)
      : wo.plannedStartDate;
    const end = dto.plannedEndDate
      ? new Date(dto.plannedEndDate)
      : wo.plannedEndDate;
    if (end < start) throw new BadRequestException('MFG_WO_END_BEFORE_START');

    const { count } = await this.prisma.workOrder.updateMany({
      where: { id, tenantId, status: 'draft', deletedAt: null },
      data: {
        ...(dto.bomId !== undefined && { bomId: dto.bomId }),
        ...(dto.plannedQty !== undefined && { plannedQty: dec(dto.plannedQty) }),
        ...(dto.plannedStartDate !== undefined && { plannedStartDate: start }),
        ...(dto.plannedEndDate !== undefined && { plannedEndDate: end }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });
    if (count === 0) throw new ConflictException('MFG_WO_NOT_DRAFT');
    return this.prisma.workOrder.findFirst({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    await this.requireWo(tenantId, id);
    const { count } = await this.prisma.workOrder.updateMany({
      where: { id, tenantId, status: 'draft', deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw new ConflictException('MFG_WO_NOT_DRAFT');
  }

  // ── State machine: draft → planned → released → in_progress → completed → closed

  async plan(tenantId: string, id: string) {
    return this.transition(tenantId, id, ['draft'], { status: 'planned' });
  }

  async release(tenantId: string, id: string) {
    return this.transition(tenantId, id, ['planned'], { status: 'released' });
  }

  async close(tenantId: string, id: string) {
    return this.transition(tenantId, id, ['completed'], { status: 'closed' });
  }

  async cancel(tenantId: string, id: string) {
    return this.transition(tenantId, id, CANCELLABLE_STATUSES, {
      status: 'cancelled',
    });
  }

  private async transition(
    tenantId: string,
    id: string,
    fromStatuses: string[],
    data: Prisma.WorkOrderUpdateManyMutationInput,
  ) {
    await this.requireWo(tenantId, id);
    const { count } = await this.prisma.workOrder.updateMany({
      where: { id, tenantId, status: { in: fromStatuses }, deletedAt: null },
      data,
    });
    if (count === 0) throw new ConflictException('MFG_WO_INVALID_TRANSITION');
    return this.prisma.workOrder.findFirst({ where: { id, tenantId } });
  }

  // ── MFG-002: Material consumption (stock OUT) ─────────────────

  async reportConsumption(
    tenantId: string,
    userId: string,
    id: string,
    dto: ReportMaterialConsumptionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
        select: { id: true, status: true, warehouseId: true },
      });
      if (!wo) throw new NotFoundException('MFG_WO_NOT_FOUND');
      if (!EXECUTABLE_STATUSES.includes(wo.status)) {
        throw new ConflictException('MFG_WO_NOT_EXECUTABLE');
      }

      // Claim the WO row before any stock writes: re-verifies the status
      // transactionally (a concurrent cancel loses) and serializes concurrent
      // consumption/output/cancel on the same WO via the row lock. First
      // consumption flips released → in_progress and stamps actualStart.
      const claim = await tx.workOrder.updateMany({
        where: { id: wo.id, tenantId, status: { in: EXECUTABLE_STATUSES } },
        data:
          wo.status === 'released'
            ? { status: 'in_progress', actualStartDate: new Date() }
            : { updatedAt: new Date() },
      });
      if (claim.count === 0) throw new ConflictException('MFG_WO_NOT_EXECUTABLE');

      for (const line of dto.lines) {
        const item = await tx.item.findFirst({
          where: { id: line.itemId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!item)
          throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${line.itemId}`);

        await this.assertBinInWarehouse(tx, line.binId, wo.warehouseId);
        await this.assertLotUsable(tx, tenantId, line.lotId, line.itemId);

        const qty = dec(line.quantity);
        const balance = await tx.inventoryBalance.findFirst({
          where: {
            tenantId,
            itemId: line.itemId,
            warehouseId: wo.warehouseId,
            variantId: null,
            binId: line.binId ?? null,
            lotId: line.lotId ?? null,
          },
        });
        const available = balance
          ? dec(balance.quantityOnHand).sub(dec(balance.quantityReserved))
          : dec(0);
        if (available.lt(qty)) {
          throw new BadRequestException(
            `INV_STOCK_INSUFFICIENT: item ${line.itemId} available ${available.toString()}, requested ${qty.toString()}`,
          );
        }

        // Guarded decrement — a concurrent consumer of the same balance loses
        // instead of driving on-hand below the reserved quantity.
        const debit = await tx.inventoryBalance.updateMany({
          where: {
            id: balance!.id,
            quantityOnHand: { gte: qty.add(dec(balance!.quantityReserved)) },
          },
          data: { quantityOnHand: { decrement: qty } },
        });
        if (debit.count === 0) {
          throw new BadRequestException(
            `INV_STOCK_INSUFFICIENT: item ${line.itemId} requested ${qty.toString()}`,
          );
        }

        await tx.stockMovement.create({
          data: {
            tenantId,
            itemId: line.itemId,
            warehouseId: wo.warehouseId,
            movementType: 'manufacturing_consumption',
            direction: 'OUT',
            quantity: qty,
            uom: balance!.uom,
            costPerUnit: balance!.costPerUnit,
            referenceType: 'WorkOrder',
            referenceId: wo.id,
            binId: line.binId ?? null,
            lotId: line.lotId ?? null,
            notes: dto.notes ?? null,
            createdBy: userId,
          },
        });
      }

      return tx.workOrder.findFirst({ where: { id: wo.id, tenantId } });
    });
  }

  // ── MFG-002: Output (stock IN of finished goods) ──────────────

  async reportOutput(
    tenantId: string,
    userId: string,
    id: string,
    dto: ReportOutputDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wo = await tx.workOrder.findFirst({
        where: { id, tenantId, deletedAt: null },
      });
      if (!wo) throw new NotFoundException('MFG_WO_NOT_FOUND');
      if (!EXECUTABLE_STATUSES.includes(wo.status)) {
        throw new ConflictException('MFG_WO_NOT_EXECUTABLE');
      }

      const produced = dec(dto.producedQty);
      const rejected = dec(dto.rejectedQty ?? 0);
      const newProduced = dec(wo.producedQty).add(produced);
      const newRejected = dec(wo.rejectedQty).add(rejected);

      if (newProduced.add(newRejected).gt(dec(wo.plannedQty))) {
        throw new BadRequestException('MFG_WO_OUTPUT_EXCEEDS_PLANNED');
      }

      const item = await tx.item.findFirst({
        where: { id: wo.itemId, tenantId, deletedAt: null },
        select: { id: true, isBatchTracked: true },
      });
      if (!item) throw new NotFoundException('MAT_ITEM_NOT_FOUND');
      if (item.isBatchTracked && !dto.lotId) {
        throw new BadRequestException(
          `INV_LOT_REQUIRED: item ${wo.itemId} is batch-tracked`,
        );
      }
      await this.assertBinInWarehouse(tx, dto.binId, wo.warehouseId);
      await this.assertLotUsable(tx, tenantId, dto.lotId, wo.itemId);

      // Optimistic claim BEFORE any stock writes: the where pins the qtys read
      // above, so a concurrent output/consumption/cancel loses with a 409
      // instead of double-counting stock or bypassing the planned-qty cap.
      const completed = newProduced.gte(dec(wo.plannedQty));
      const claim = await tx.workOrder.updateMany({
        where: {
          id: wo.id,
          tenantId,
          status: { in: EXECUTABLE_STATUSES },
          producedQty: wo.producedQty,
          rejectedQty: wo.rejectedQty,
        },
        data: {
          producedQty: newProduced,
          rejectedQty: newRejected,
          ...(wo.status === 'released' && { actualStartDate: new Date() }),
          ...(completed
            ? { status: 'completed', actualEndDate: new Date() }
            : { status: 'in_progress' }),
        },
      });
      if (claim.count === 0) {
        throw new ConflictException('MFG_WO_CONCURRENT_UPDATE');
      }

      // Good units go into stock at the WO warehouse.
      const balance = await tx.inventoryBalance.findFirst({
        where: {
          tenantId,
          itemId: wo.itemId,
          warehouseId: wo.warehouseId,
          variantId: null,
          binId: dto.binId ?? null,
          lotId: dto.lotId ?? null,
        },
      });
      if (balance) {
        await tx.inventoryBalance.update({
          where: { id: balance.id },
          data: { quantityOnHand: { increment: produced } },
        });
      } else {
        await tx.inventoryBalance.create({
          data: {
            tenantId,
            itemId: wo.itemId,
            warehouseId: wo.warehouseId,
            variantId: null,
            binId: dto.binId ?? null,
            lotId: dto.lotId ?? null,
            quantityOnHand: produced,
            costPerUnit: 0,
            uom: wo.uom,
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          tenantId,
          itemId: wo.itemId,
          warehouseId: wo.warehouseId,
          movementType: 'manufacturing_output',
          direction: 'IN',
          quantity: produced,
          uom: wo.uom,
          referenceType: 'WorkOrder',
          referenceId: wo.id,
          binId: dto.binId ?? null,
          lotId: dto.lotId ?? null,
          notes: dto.notes ?? null,
          createdBy: userId,
        },
      });

      return tx.workOrder.findFirst({ where: { id: wo.id, tenantId } });
    });
  }

  // ── Shared reference validation ───────────────────────────────

  /** A referenced bin must belong (via its zone) to the given warehouse. */
  private async assertBinInWarehouse(
    tx: Prisma.TransactionClient,
    binId: string | undefined,
    warehouseId: string,
  ) {
    if (!binId) return;
    const bin = await tx.bin.findFirst({
      where: { id: binId, zone: { warehouseId } },
      select: { id: true },
    });
    if (!bin) throw new BadRequestException(`WMS_BIN_NOT_IN_WAREHOUSE: ${binId}`);
  }

  /** A referenced lot must belong to this tenant + item and be active. */
  private async assertLotUsable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lotId: string | undefined,
    itemId: string,
  ) {
    if (!lotId) return;
    const lot = await tx.lot.findFirst({
      where: { id: lotId, tenantId },
      select: { id: true, itemId: true, status: true },
    });
    if (!lot) throw new NotFoundException(`INV_LOT_NOT_FOUND: ${lotId}`);
    if (lot.itemId !== itemId) {
      throw new ConflictException(`INV_LOT_ITEM_MISMATCH: ${lotId}`);
    }
    if (lot.status !== 'active') {
      throw new ConflictException(`INV_LOT_INACTIVE: ${lotId}`);
    }
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(tenantId: string, query: WorkOrderQueryDto, userRoles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      WORK_ORDER_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      itemId,
      warehouseId,
      status,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, WO_SORTABLE);

    const where: Prisma.WorkOrderWhereInput = {
      tenantId,
      deletedAt: null,
      ...(itemId && { itemId }),
      ...(warehouseId && { warehouseId }),
      ...(status && { status }),
      ...(search && { woNumber: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.workOrder.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(tenantId: string, id: string, userRoles: string[], fields?: string) {
    const select = FieldSelector.buildPrismaSelect(
      fields,
      userRoles,
      WORK_ORDER_FIELD_CONFIG,
    );
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select,
    });
    if (!wo) throw new NotFoundException('MFG_WO_NOT_FOUND');
    return wo;
  }

  private async requireWo(tenantId: string, id: string) {
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        itemId: true,
        plannedStartDate: true,
        plannedEndDate: true,
      },
    });
    if (!wo) throw new NotFoundException('MFG_WO_NOT_FOUND');
    return wo;
  }
}
