import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { isTenantModuleEntityKey } from '../../../infra/storage/storage-key.util.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { ShipmentService } from '../../shp/services/shipment.service.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { DELIVERY_NOTE_FIELD_CONFIG } from '../config/delivery-note.field-config.js';
import {
  ConfirmPackedDto,
  ConfirmPickedDto,
  CreateDeliveryNoteDto,
  DeliveryNoteQueryDto,
  DeliveryScheduleQueryDto,
  DispatchDeliveryDto,
  FailDeliveryDto,
  ReturnDeliveryDto,
  SubmitPODDto,
} from '../dto/delivery-note.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const ZERO = new Prisma.Decimal(0);

const DN_SORTABLE = [
  'createdAt',
  'updatedAt',
  'dnNumber',
  'status',
  'shipDate',
] as const;
const MAX_RETRY = 3;

/** SO statuses from which delivery notes may be created. */
const DELIVERABLE_SO_STATUSES = ['approved', 'processing'];

@Injectable()
export class DeliveryNoteService {
  private readonly logger = new Logger(DeliveryNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
    @Inject(forwardRef(() => ShipmentService))
    private readonly shipments: ShipmentService,
  ) {}

  // ── Create from SO ────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateDeliveryNoteDto) {
    return this.prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { id: dto.soId, tenantId, deletedAt: null },
        include: { lines: true },
      });
      if (!so) throw new NotFoundException('SAL_SO_NOT_FOUND');
      if (!DELIVERABLE_SO_STATUSES.includes(so.status)) {
        throw new ConflictException('DEL_SO_NOT_APPROVED');
      }

      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!warehouse) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      const soLineById = new Map(so.lines.map((l) => [l.id, l]));
      const dnLines: Prisma.DeliveryNoteLineCreateManyDnInput[] = [];
      let sortOrder = 0;

      for (const line of dto.lines) {
        const soLine = soLineById.get(line.soLineId);
        if (!soLine)
          throw new NotFoundException(
            `SAL_SO_LINE_NOT_FOUND: ${line.soLineId}`,
          );

        const item = await tx.item.findFirst({
          where: { id: soLine.itemId, tenantId, deletedAt: null },
          select: {
            id: true,
            sku: true,
            isBatchTracked: true,
            isSerialTracked: true,
          },
        });
        if (!item)
          throw new NotFoundException(`MAT_ITEM_NOT_FOUND: ${soLine.itemId}`);
        if (item.isBatchTracked && !line.lotId)
          throw new BadRequestException(`INV_LOT_REQUIRED: ${item.sku}`);
        if (item.isSerialTracked && !line.serialId)
          throw new BadRequestException(`INV_SERIAL_REQUIRED: ${item.sku}`);

        // Remaining = SO line qty − already shipped − qty already in open DNs.
        const shipped = dec(soLine.shippedQty);
        const openInDns = await this.openDnQtyForSoLine(
          tx,
          tenantId,
          line.soLineId,
        );
        const remaining = dec(soLine.quantity).sub(shipped).sub(openInDns);
        const qty = dec(line.quantity);
        if (qty.gt(remaining)) {
          throw new BadRequestException(
            `DEL_DN_EXCEEDS_SO_QTY: item ${item.sku} remaining ${remaining.toString()}, requested ${qty.toString()}`,
          );
        }

        dnLines.push({
          soLineId: line.soLineId,
          itemId: soLine.itemId,
          quantity: qty,
          uom: soLine.uom,
          binId: line.binId ?? null,
          lotId: line.lotId ?? null,
          serialId: line.serialId ?? null,
          sortOrder: sortOrder++,
        });
      }

      const dnNumber = await this.sequences.getNextNumber(
        tenantId,
        'DN',
        undefined,
        tx,
      );

      const dn = await tx.deliveryNote.create({
        data: {
          tenantId,
          dnNumber,
          soId: so.id,
          warehouseId: dto.warehouseId,
          customerId: so.customerId,
          status: 'draft',
          shipDate: dto.shipDate ? new Date(dto.shipDate) : new Date(),
          shippingAddress: dto.shippingAddress ?? null,
          contactPerson: dto.contactPerson ?? null,
          contactPhone: dto.contactPhone ?? null,
          deliveryInstructions: dto.deliveryInstructions ?? null,
          createdBy: userId,
          lines: { create: dnLines },
        },
        include: { lines: true },
      });

      // First DN for the SO moves it into `processing`.
      if (so.status === 'approved') {
        await tx.salesOrder.updateMany({
          where: { id: so.id, tenantId, status: 'approved' },
          data: { status: 'processing' },
        });
      }

      return dn;
    });
  }

  /** Sum of quantities tied up in not-yet-terminal DNs for a SO line. */
  private async openDnQtyForSoLine(
    tx: Prisma.TransactionClient,
    tenantId: string,
    soLineId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await tx.deliveryNoteLine.findMany({
      where: {
        soLineId,
        // Exclude terminal statuses. 'delivered' DNs already have their qty
        // reflected in soLine.shippedQty (incremented by submitPod), so
        // counting them here would double-subtract against the remaining qty.
        dn: {
          tenantId,
          status: { notIn: ['returned', 'failed', 'delivered'] },
        },
      },
      select: { quantity: true },
    });
    return rows.reduce((s, r) => s.add(dec(r.quantity)), ZERO);
  }

  // ── State machine ─────────────────────────────────────────────

  async startPicking(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { lines: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'draft')
        throw new ConflictException('DEL_DN_NOT_DRAFT');

      // Validate available stock per line at the DN warehouse (warehouse-level).
      for (const line of dn.lines) {
        const available = await this.availableQty(
          tx,
          tenantId,
          dn.warehouseId,
          line.itemId,
        );
        if (available.lt(dec(line.quantity))) {
          const item = await tx.item.findFirst({
            where: { id: line.itemId },
            select: { sku: true },
          });
          throw new BadRequestException(
            `INV_STOCK_INSUFFICIENT: item ${item?.sku ?? line.itemId} available ${available.toString()}`,
          );
        }
      }

      const { count } = await tx.deliveryNote.updateMany({
        where: { id, tenantId, status: 'draft' },
        data: { status: 'picking' },
      });
      if (count === 0) throw new ConflictException('DEL_DN_NOT_DRAFT');
      return tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
    });
  }

  async confirmPicked(tenantId: string, id: string, dto: ConfirmPickedDto) {
    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'picking')
        throw new ConflictException('DEL_DN_NOT_PICKING');

      const lineById = new Map(dn.lines.map((l) => [l.id, l]));
      for (const pick of dto.lines) {
        const line = lineById.get(pick.dnLineId);
        if (!line)
          throw new NotFoundException(
            `DEL_DN_LINE_NOT_FOUND: ${pick.dnLineId}`,
          );
        // Picked qty must match planned qty (no short-pick without adjustment).
        if (!dec(pick.pickedQty).equals(dec(line.quantity))) {
          throw new BadRequestException(
            `DEL_PICK_QTY_MISMATCH: line ${pick.dnLineId} expected ${line.quantity.toString()}, picked ${pick.pickedQty}`,
          );
        }
        await tx.deliveryNoteLine.update({
          where: { id: line.id },
          data: {
            pickedQty: dec(pick.pickedQty),
            actualBinId: pick.actualBinId ?? line.binId,
            actualLotId: pick.actualLotId ?? line.lotId,
            actualSerialId: pick.actualSerialId ?? line.serialId,
          },
        });
      }

      const { count } = await tx.deliveryNote.updateMany({
        where: { id, tenantId, status: 'picking' },
        data: { status: 'picked' },
      });
      if (count === 0) throw new ConflictException('DEL_DN_NOT_PICKING');
      return tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
    });
  }

  async pack(tenantId: string, id: string, dto: ConfirmPackedDto) {
    const dn = await this.require(tenantId, id);
    if (dn.status !== 'picked')
      throw new ConflictException('DEL_DN_NOT_PICKED');
    const { count } = await this.prisma.deliveryNote.updateMany({
      where: { id, tenantId, status: 'picked' },
      data: {
        status: 'packed',
        packedWeightKg: dec(dto.totalWeightKg),
        totalPackages: dto.totalPackages ?? 1,
        packingNotes: dto.packingNotes ?? null,
      },
    });
    if (count === 0) throw new ConflictException('DEL_DN_NOT_PICKED');
    return this.prisma.deliveryNote.findFirst({ where: { id, tenantId } });
  }

  async dispatch(
    tenantId: string,
    userId: string,
    id: string,
    dto: DispatchDeliveryDto,
  ) {
    const dn = await this.require(tenantId, id);
    if (dn.status !== 'packed')
      throw new ConflictException('DEL_DN_NOT_PACKED');

    if (dto.deliveryMethod === 'self_delivery' && !dto.driverName) {
      throw new BadRequestException('DEL_DRIVER_REQUIRED');
    }
    if (dto.deliveryMethod === 'carrier' && !dto.carrierId) {
      throw new BadRequestException('DEL_CARRIER_REQUIRED');
    }

    // SHP-003: for a carrier dispatch, validate the carrier is active before we
    // transition the DN (so a bad carrier id fails fast and leaves the DN packed).
    if (dto.deliveryMethod === 'carrier') {
      const carrier = await this.prisma.carrier.findFirst({
        where: { id: dto.carrierId, tenantId },
        select: { id: true, isActive: true },
      });
      if (!carrier) throw new NotFoundException('SHP_CARRIER_NOT_FOUND');
      if (!carrier.isActive)
        throw new ConflictException('SHP_CARRIER_INACTIVE');
    }

    const { count } = await this.prisma.deliveryNote.updateMany({
      where: { id, tenantId, status: 'packed' },
      data: {
        status: 'out_for_delivery',
        deliveryMethod: dto.deliveryMethod,
        driverName: dto.driverName ?? null,
        driverPhone: dto.driverPhone ?? null,
        vehiclePlate: dto.vehiclePlate ?? null,
        carrierId: dto.carrierId ?? null,
        serviceType: dto.serviceType ?? null,
      },
    });
    if (count === 0) throw new ConflictException('DEL_DN_NOT_PACKED');

    // SHP-003: auto-create the carrier shipment (tracking + label) now that the
    // DN is out_for_delivery. Best-effort — a shipment failure does not roll
    // back the dispatch; the shipment can be created/retried via the SHP API.
    if (dto.deliveryMethod === 'carrier' && this.shipments) {
      try {
        await this.shipments.createForDelivery(
          tenantId,
          userId,
          id,
          dto.carrierId!,
          { serviceType: dto.serviceType },
        );
      } catch (err) {
        this.logger.warn(
          `Auto-create shipment for DN ${id} failed: ${(err as Error).message}`,
        );
      }
    }
    return this.prisma.deliveryNote.findFirst({ where: { id, tenantId } });
  }

  // ── POD → delivered (§1.5 completion side effects) ────────────

  async submitPod(
    tenantId: string,
    userId: string,
    id: string,
    dto: SubmitPODDto,
  ) {
    if (
      (dto.podType === 'signature' || dto.podType === 'both') &&
      !dto.signatureDataUrl
    ) {
      throw new BadRequestException('DEL_POD_SIGNATURE_REQUIRED');
    }
    if (
      (dto.podType === 'photo' || dto.podType === 'both') &&
      (!dto.photoUrls || dto.photoUrls.length === 0)
    ) {
      throw new BadRequestException('DEL_POD_PHOTO_REQUIRED');
    }
    // POD photos must be storage KEYS under this tenant's `del/{dnId}` prefix
    // (issued by the files presign endpoint) — never arbitrary client URLs.
    for (const key of dto.photoUrls ?? []) {
      if (!isTenantModuleEntityKey(tenantId, 'del', id, key)) {
        throw new BadRequestException('DEL_POD_PHOTO_KEY_INVALID');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'out_for_delivery') {
        throw new ConflictException('DEL_DN_NOT_OUT_FOR_DELIVERY');
      }

      // Claim the transition first so concurrent PODs can't double-ship.
      const claimed = await tx.deliveryNote.updateMany({
        where: { id, tenantId, status: 'out_for_delivery' },
        data: {
          status: 'delivered',
          deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : new Date(),
          podType: dto.podType,
          receiverName: dto.receiverName ?? null,
          podSignature: dto.signatureDataUrl ?? null,
          podPhotoUrls: dto.photoUrls ?? Prisma.JsonNull,
          podNotes: dto.deliveryNotes ?? null,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('DEL_DN_NOT_OUT_FOR_DELIVERY');
      }

      // §1.5: deduct stock OUT, release reservation, advance SO shipped qty.
      await this.applyDeliveryEffects(tx, tenantId, userId, dn);
      return tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
    });
  }

  /**
   * §1.5 completion side effects, shared by {@link submitPod} and the
   * shipment-driven {@link completeFromShipment}: deduct stock OUT per line,
   * release the matching reservation, and advance the SO shipped quantity.
   */
  private async applyDeliveryEffects(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dn: Prisma.DeliveryNoteGetPayload<{ include: { lines: true } }>,
  ) {
    for (const line of dn.lines) {
      const qty = dec(line.quantity);
      const costPerUnit = await this.shipStock(
        tx,
        tenantId,
        dn.warehouseId,
        line.itemId,
        qty,
      );
      await tx.stockMovement.create({
        data: {
          tenantId,
          itemId: line.itemId,
          warehouseId: dn.warehouseId,
          movementType: 'sales_shipment',
          direction: 'OUT',
          quantity: qty,
          uom: line.uom,
          costPerUnit,
          referenceType: 'DeliveryNote',
          referenceId: dn.id,
          binId: line.actualBinId ?? line.binId,
          lotId: line.actualLotId ?? line.lotId,
          createdBy: userId,
        },
      });
      await tx.salesOrderLine.update({
        where: { id: line.soLineId },
        data: { shippedQty: { increment: qty } },
      });
    }
    await this.recomputeSoStatus(tx, tenantId, dn.soId);
  }

  // ── Shipment-driven sync (SHP-002 webhook → DN, §1.5) ─────────

  /**
   * Carrier reported the shipment as delivered: run the §1.5 completion side
   * effects and move the DN out_for_delivery → delivered. Idempotent — a DN
   * already past out_for_delivery is left untouched (concurrent/duplicate
   * webhooks). Uses the DN's creator as the stock-movement actor.
   */
  async completeFromShipment(tenantId: string, dnId: string) {
    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id: dnId, tenantId },
        include: { lines: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'out_for_delivery') {
        // Already delivered/returned/etc. — nothing to do.
        return { id: dnId, status: dn.status, changed: false };
      }
      const claimed = await tx.deliveryNote.updateMany({
        where: { id: dnId, tenantId, status: 'out_for_delivery' },
        data: {
          status: 'delivered',
          deliveredAt: new Date(),
          podType: 'otp',
          podNotes: 'Auto-completed from carrier delivery confirmation',
        },
      });
      if (claimed.count === 0) {
        return { id: dnId, status: dn.status, changed: false };
      }
      await this.applyDeliveryEffects(tx, tenantId, dn.createdBy, dn);
      return { id: dnId, status: 'delivered', changed: true };
    });
  }

  /**
   * Carrier reported the shipment as failed: move out_for_delivery → failed and
   * bump retryCount, mirroring a manual {@link fail}. Idempotent.
   */
  async failFromShipment(tenantId: string, dnId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id: dnId, tenantId },
        select: { id: true, status: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'out_for_delivery') {
        return { id: dnId, status: dn.status, changed: false };
      }
      const claimed = await tx.deliveryNote.updateMany({
        where: { id: dnId, tenantId, status: 'out_for_delivery' },
        data: {
          status: 'failed',
          failureReason: 'other',
          retryCount: { increment: 1 },
          notes: reason.slice(0, 1000),
        },
      });
      if (claimed.count === 0) {
        return { id: dnId, status: dn.status, changed: false };
      }
      return { id: dnId, status: 'failed', changed: true };
    });
  }

  // ── Failure / retry / return ──────────────────────────────────

  async fail(tenantId: string, id: string, dto: FailDeliveryDto) {
    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id, tenantId },
        select: { id: true, status: true, retryCount: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'out_for_delivery') {
        throw new ConflictException('DEL_DN_NOT_OUT_FOR_DELIVERY');
      }
      const { count } = await tx.deliveryNote.updateMany({
        where: { id, tenantId, status: 'out_for_delivery' },
        data: {
          status: 'failed',
          failureReason: dto.failureReason,
          retryCount: { increment: 1 },
          notes: dto.notes ?? undefined,
        },
      });
      if (count === 0)
        throw new ConflictException('DEL_DN_NOT_OUT_FOR_DELIVERY');
      return tx.deliveryNote.findFirst({ where: { id, tenantId } });
    });
  }

  /** Re-attempt a failed delivery (failed → out_for_delivery) while retries remain. */
  async redispatch(tenantId: string, id: string) {
    const dn = await this.require(tenantId, id);
    if (dn.status !== 'failed')
      throw new ConflictException('DEL_DN_NOT_FAILED');
    if (dn.retryCount >= MAX_RETRY) {
      throw new ConflictException('DEL_MAX_RETRY_EXCEEDED');
    }
    const { count } = await this.prisma.deliveryNote.updateMany({
      where: { id, tenantId, status: 'failed' },
      data: { status: 'out_for_delivery' },
    });
    if (count === 0) throw new ConflictException('DEL_DN_NOT_FAILED');
    return this.prisma.deliveryNote.findFirst({ where: { id, tenantId } });
  }

  async returnDelivery(tenantId: string, id: string, dto: ReturnDeliveryDto) {
    return this.prisma.$transaction(async (tx) => {
      const dn = await tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
      if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
      if (dn.status !== 'failed')
        throw new ConflictException('DEL_DN_NOT_FAILED');

      const returnWh = await tx.warehouse.findFirst({
        where: { id: dto.returnWarehouseId, tenantId, isActive: true },
        select: { id: true },
      });
      if (!returnWh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

      const claimed = await tx.deliveryNote.updateMany({
        where: { id, tenantId, status: 'failed' },
        data: {
          status: 'returned',
          returnReason: dto.returnReason,
          returnWarehouseId: dto.returnWarehouseId,
          notes: dto.notes ?? undefined,
        },
      });
      if (claimed.count === 0) throw new ConflictException('DEL_DN_NOT_FAILED');

      // A failed DN never reached `delivered`, so stock was never deducted
      // (§1.5 deducts only on delivery). The goods were reserved at SO confirm
      // and are physically back at the warehouse — release the reservation so
      // the quantity becomes available again. No onHand change, shippedQty
      // unchanged (it was never incremented). An audit movement is recorded.
      for (const line of dn.lines) {
        await this.releaseReservation(
          tx,
          tenantId,
          dn.warehouseId,
          line.itemId,
          dec(line.quantity),
        );
        await tx.stockMovement.create({
          data: {
            tenantId,
            itemId: line.itemId,
            warehouseId: dto.returnWarehouseId,
            movementType: 'sales_return',
            direction: 'IN',
            quantity: dec(line.quantity),
            uom: line.uom,
            referenceType: 'DeliveryNote',
            referenceId: dn.id,
            notes: `Return: ${dto.returnReason}`,
            createdBy: dn.createdBy,
          },
        });
      }

      return tx.deliveryNote.findFirst({
        where: { id, tenantId },
        include: { lines: true },
      });
    });
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: DeliveryNoteQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      DELIVERY_NOTE_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      status,
      soId,
      warehouseId,
      customerId,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, DN_SORTABLE);

    const where: Prisma.DeliveryNoteWhereInput = {
      tenantId,
      deletedAt: null,
      ...(status && { status }),
      ...(soId && { soId }),
      ...(warehouseId && { warehouseId }),
      ...(customerId && { customerId }),
      ...(search && { dnNumber: { contains: search, mode: 'insensitive' } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.deliveryNote.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.deliveryNote.count({ where }),
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
      DELIVERY_NOTE_FIELD_CONFIG,
    );
    const dn = await this.prisma.deliveryNote.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { ...select, lines: true },
    });
    if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
    return dn;
  }

  async schedule(tenantId: string, query: DeliveryScheduleQueryDto) {
    return this.prisma.deliveryNote.findMany({
      where: {
        tenantId,
        deletedAt: null,
        shipDate: {
          gte: new Date(query.dateFrom),
          lte: new Date(query.dateTo + 'T23:59:59.999Z'),
        },
        ...(query.warehouseId && { warehouseId: query.warehouseId }),
        ...(query.driverName && {
          driverName: { contains: query.driverName, mode: 'insensitive' },
        }),
        status: { notIn: ['delivered', 'returned'] },
      },
      orderBy: { shipDate: 'asc' },
    });
  }

  // ── Inventory helpers (warehouse-level, guarded) ──────────────

  private async availableQty(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    itemId: string,
  ): Promise<Prisma.Decimal> {
    const balances = await tx.inventoryBalance.findMany({
      where: { tenantId, itemId, warehouseId },
      select: { quantityOnHand: true, quantityReserved: true },
    });
    return balances.reduce(
      (s, b) => s.add(dec(b.quantityOnHand).sub(dec(b.quantityReserved))),
      ZERO,
    );
  }

  /**
   * Decrements onHand (and the matching reservation) greedily across the
   * item/warehouse balance rows. Returns the cost/unit of the first touched row
   * for the stock movement. Each decrement is guarded so a concurrent shipment
   * can't drive a balance negative.
   */
  private async shipStock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    warehouseId: string,
    itemId: string,
    qty: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const balances = await tx.inventoryBalance.findMany({
      where: { tenantId, itemId, warehouseId },
      orderBy: { quantityOnHand: 'desc' },
    });
    let remaining = qty;
    let costPerUnit = ZERO;
    for (const b of balances) {
      if (remaining.lte(0)) break;
      const onHand = dec(b.quantityOnHand);
      if (onHand.lte(0)) continue;
      const take = Prisma.Decimal.min(onHand, remaining);
      const reserved = dec(b.quantityReserved);
      const releaseReserved = Prisma.Decimal.min(take, reserved);
      const updated = await tx.inventoryBalance.updateMany({
        where: { id: b.id, quantityOnHand: { gte: take } },
        data: {
          quantityOnHand: { decrement: take },
          quantityReserved: { decrement: releaseReserved },
        },
      });
      if (updated.count === 0) continue; // lost race — try the next row
      if (costPerUnit.lte(0)) costPerUnit = dec(b.costPerUnit);
      remaining = remaining.sub(take);
    }
    if (remaining.gt(0)) {
      throw new BadRequestException(
        `INV_STOCK_INSUFFICIENT: item ${itemId} short by ${remaining.toString()} at delivery`,
      );
    }
    return costPerUnit;
  }

  /** Releases a reservation greedily; never drives quantityReserved negative. */
  private async releaseReservation(
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
      const take = Prisma.Decimal.min(dec(b.quantityReserved), remaining);
      if (take.lte(0)) continue;
      const updated = await tx.inventoryBalance.updateMany({
        where: { id: b.id, quantityReserved: { gte: take } },
        data: { quantityReserved: { decrement: take } },
      });
      if (updated.count > 0) remaining = remaining.sub(take);
    }
  }

  private async recomputeSoStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    soId: string,
  ) {
    const lines = await tx.salesOrderLine.findMany({ where: { soId } });
    const fullyShipped = lines.every((l) =>
      dec(l.shippedQty).gte(dec(l.quantity)),
    );
    // Do not overwrite terminal SO statuses (cancelled, on_hold).
    await tx.salesOrder.updateMany({
      where: {
        id: soId,
        tenantId,
        status: { notIn: ['cancelled', 'on_hold'] },
      },
      data: { status: fullyShipped ? 'fulfilled' : 'partial_shipped' },
    });
  }

  private async require(tenantId: string, id: string) {
    const dn = await this.prisma.deliveryNote.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, status: true, retryCount: true },
    });
    if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
    return dn;
  }
}
