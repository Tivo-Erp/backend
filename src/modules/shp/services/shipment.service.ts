import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { DocumentSequenceService } from '../../../infra/sequence/document-sequence.service.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
import { CacheService } from '../../../infra/cache/cache.service.js';
import { OutboxService } from '../../../infra/events/outbox.service.js';
import { EVENT } from '../../../infra/events/event-catalog.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';
import { DeliveryNoteService } from '../../del/services/delivery-note.service.js';
import { SHIPMENT_FIELD_CONFIG } from '../config/shp.field-config.js';
import {
  canTransition,
  normalizeCarrierStatus,
} from '../shipment-status.util.js';
import { CarrierAdapterFactory } from '../adapters/carrier-adapter.factory.js';
import type {
  CarrierContext,
  RateRequest,
  RateQuote,
} from '../adapters/carrier-adapter.interface.js';
import {
  CreateShipmentDto,
  ManualTrackingDto,
  RateCompareDto,
  ShipmentQueryDto,
  TrackingWebhookDto,
} from '../dto/shipment.dto.js';

const dec = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
const SHIPMENT_SORTABLE = [
  'createdAt',
  'updatedAt',
  'shipmentNumber',
  'status',
] as const;
const RATE_CACHE_TTL_SEC = 15 * 60;

/** DN statuses from which a carrier shipment may be created. */
const SHIPPABLE_DN_STATUSES = ['packed', 'out_for_delivery'];

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: DocumentSequenceService,
    private readonly storage: StorageService,
    private readonly cache: CacheService,
    private readonly outbox: OutboxService,
    private readonly adapters: CarrierAdapterFactory,
    @Inject(forwardRef(() => DeliveryNoteService))
    private readonly deliveryNotes: DeliveryNoteService,
  ) {}

  // ── Create ────────────────────────────────────────────────────

  /** Public API create (POST /shipping/shipments). */
  async create(tenantId: string, userId: string, dto: CreateShipmentDto) {
    if (dto.isCod && (dto.codAmount == null || dto.codAmount <= 0)) {
      throw new BadRequestException('SHP_COD_AMOUNT_REQUIRED');
    }
    return this.createForDelivery(tenantId, userId, dto.dnId, dto.carrierId, {
      serviceType: dto.serviceType,
      weightKg: dto.weightKg,
      lengthCm: dto.lengthCm,
      widthCm: dto.widthCm,
      heightCm: dto.heightCm,
      isCod: dto.isCod,
      codAmount: dto.codAmount,
      toRegion: dto.toRegion,
    });
  }

  /**
   * Core creation path shared by the public endpoint and DEL dispatch wiring
   * (SHP-003). Validates the DN + carrier, reserves a shipment number, and asks
   * the carrier adapter for a tracking number + label when it can reach a live
   * API; otherwise the shipment starts in `created` awaiting manual tracking.
   */
  async createForDelivery(
    tenantId: string,
    userId: string,
    dnId: string,
    carrierId: string,
    opts: {
      serviceType?: string;
      weightKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      isCod?: boolean;
      codAmount?: number;
      toRegion?: string;
    } = {},
  ) {
    const dn = await this.prisma.deliveryNote.findFirst({
      where: { id: dnId, tenantId, deletedAt: null },
      select: { id: true, status: true, packedWeightKg: true },
    });
    if (!dn) throw new NotFoundException('DEL_DN_NOT_FOUND');
    if (!SHIPPABLE_DN_STATUSES.includes(dn.status)) {
      throw new ConflictException('SHP_DN_NOT_SHIPPABLE');
    }

    const existing = await this.prisma.shipment.findUnique({
      where: { dnId },
      select: { id: true },
    });
    if (existing) throw new ConflictException('SHP_SHIPMENT_ALREADY_EXISTS');

    const carrier = await this.prisma.carrier.findFirst({
      where: { id: carrierId, tenantId },
    });
    if (!carrier) throw new NotFoundException('SHP_CARRIER_NOT_FOUND');
    if (!carrier.isActive) throw new ConflictException('SHP_CARRIER_INACTIVE');

    const weightKg =
      opts.weightKg ??
      (dn.packedWeightKg ? Number(dn.packedWeightKg) : undefined) ??
      1;

    // Reserve number + opaque public tracking token first (outside the carrier
    // call, which may be slow/flaky).
    const shipmentNumber = await this.sequences.getNextNumber(tenantId, 'SHP');
    const trackingToken = randomBytes(24).toString('hex');

    // Ask the carrier for a label/tracking number — best-effort. A live
    // adapter that errors degrades to a manual-tracking shipment rather than
    // failing the whole dispatch.
    const ctx = this.carrierContext(carrier);
    const adapter = this.adapters.forCode(carrier.code);
    let trackingNumber: string | null = null;
    let labelKey: string | null = null;
    let shippingCost: Prisma.Decimal | null = null;
    let estimatedDelivery: Date | null = null;
    let status = 'created';

    if (adapter.isLive(ctx)) {
      try {
        const label = await adapter.getLabel(ctx, {
          shipmentNumber,
          serviceType: opts.serviceType,
          weightKg,
          isCod: opts.isCod,
          codAmount: opts.codAmount,
          toRegion: opts.toRegion,
        });
        trackingNumber = label.trackingNumber;
        shippingCost =
          label.shippingCost != null ? dec(label.shippingCost) : null;
        estimatedDelivery = label.estimatedDelivery ?? null;
        status = 'label_printed';
        if (label.labelContent && this.storage.configured) {
          const key = this.storage.buildKey(
            tenantId,
            'shp',
            shipmentNumber,
            `label.${label.labelContentType === 'application/pdf' ? 'pdf' : 'txt'}`,
          );
          await this.storage.putObject(
            key,
            label.labelContent,
            label.labelContentType ?? 'application/octet-stream',
          );
          labelKey = key;
        }
      } catch (err) {
        this.logger.warn(
          `Carrier ${carrier.code} label fetch failed for ${shipmentNumber}; falling back to manual tracking: ${(err as Error).message}`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const shipment = await tx.shipment.create({
        data: {
          tenantId,
          shipmentNumber,
          dnId,
          carrierId,
          trackingNumber,
          shippingLabelKey: labelKey,
          status,
          serviceType: opts.serviceType ?? null,
          weightKg: dec(weightKg),
          lengthCm: opts.lengthCm != null ? dec(opts.lengthCm) : null,
          widthCm: opts.widthCm != null ? dec(opts.widthCm) : null,
          heightCm: opts.heightCm != null ? dec(opts.heightCm) : null,
          isCod: opts.isCod ?? false,
          codAmount: opts.codAmount != null ? dec(opts.codAmount) : null,
          shippingCost,
          trackingToken,
          estimatedDelivery,
          createdBy: userId,
        },
      });
      // First tracking event mirrors the creation status.
      await tx.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status,
          description: `Shipment ${shipmentNumber} created with ${carrier.code}`,
          eventTime: new Date(),
        },
      });
      return shipment;
    });
  }

  // ── Manual tracking entry (no live carrier API) ───────────────

  async setManualTracking(
    tenantId: string,
    id: string,
    dto: ManualTrackingDto,
  ) {
    const shipment = await this.require(tenantId, id);
    if (shipment.trackingNumber) {
      throw new ConflictException('SHP_TRACKING_ALREADY_SET');
    }
    try {
      await this.prisma.shipment.update({
        where: { id },
        data: {
          trackingNumber: dto.trackingNumber,
          status:
            shipment.status === 'created' ? 'label_printed' : shipment.status,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('SHP_TRACKING_NUMBER_TAKEN');
      }
      throw err;
    }
    return this.findOne(tenantId, id, ['tenant_owner']);
  }

  // ── Queries ───────────────────────────────────────────────────

  async findAll(tenantId: string, query: ShipmentQueryDto, roles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      roles,
      SHIPMENT_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      status,
      carrierId,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, SHIPMENT_SORTABLE);

    const where: Prisma.ShipmentWhereInput = {
      tenantId,
      ...(status && { status }),
      ...(carrierId && { carrierId }),
      ...(search && {
        OR: [
          { shipmentNumber: { contains: search, mode: 'insensitive' } },
          { trackingNumber: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.shipment.count({ where }),
    ]);
    return PaginatedResponseDto.create(data, total, page, limit);
  }

  async findOne(
    tenantId: string,
    id: string,
    roles: string[],
    fields?: string,
  ) {
    const select = FieldSelector.buildPrismaSelect(
      fields,
      roles,
      SHIPMENT_FIELD_CONFIG,
    );
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      select,
    });
    if (!shipment) throw new NotFoundException('SHP_SHIPMENT_NOT_FOUND');
    return shipment;
  }

  /** Tracking timeline for an authenticated caller. */
  async track(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        shipmentNumber: true,
        trackingNumber: true,
        status: true,
        estimatedDelivery: true,
        actualDelivery: true,
        trackingEvents: {
          orderBy: { eventTime: 'asc' },
          select: {
            status: true,
            description: true,
            location: true,
            eventTime: true,
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('SHP_SHIPMENT_NOT_FOUND');
    return shipment;
  }

  /** Public tracking by opaque token — no tenant context, no PII. */
  async trackByToken(token: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { trackingToken: token },
      select: {
        shipmentNumber: true,
        trackingNumber: true,
        status: true,
        estimatedDelivery: true,
        actualDelivery: true,
        trackingEvents: {
          orderBy: { eventTime: 'asc' },
          select: {
            status: true,
            description: true,
            location: true,
            eventTime: true,
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('SHP_SHIPMENT_NOT_FOUND');
    return shipment;
  }

  /** Pre-signed label download URL. */
  async getLabelUrl(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      select: { shippingLabelKey: true },
    });
    if (!shipment) throw new NotFoundException('SHP_SHIPMENT_NOT_FOUND');
    if (!shipment.shippingLabelKey) {
      throw new NotFoundException('SHP_LABEL_NOT_AVAILABLE');
    }
    // Defense-in-depth: the key must live under this tenant's prefix.
    this.storage.assertTenantOwnsKey(tenantId, shipment.shippingLabelKey);
    return this.storage.presignDownload(shipment.shippingLabelKey);
  }

  // ── Rate comparison ───────────────────────────────────────────

  async compareRates(tenantId: string, dto: RateCompareDto) {
    const where: Prisma.CarrierWhereInput = {
      tenantId,
      isActive: true,
      ...(dto.carrierIds?.length ? { id: { in: dto.carrierIds } } : {}),
    };
    const carriers = await this.prisma.carrier.findMany({ where });
    if (carriers.length === 0) return { quotes: [] };

    const req: RateRequest = {
      weightKg: dto.weightKg,
      lengthCm: dto.lengthCm,
      widthCm: dto.widthCm,
      heightCm: dto.heightCm,
      serviceType: dto.serviceType,
      isCod: dto.isCod,
      codAmount: dto.codAmount,
      toRegion: dto.toRegion,
    };

    // Query carriers in parallel, each guarded by a 5s timeout; a slow/failing
    // carrier is simply omitted from the comparison. Whole results cached 15m.
    const cacheKey = this.cache.key(
      tenantId,
      'shp:rates',
      JSON.stringify({ ids: carriers.map((c) => c.id).sort(), req }),
    );
    return this.cache.wrap(cacheKey, RATE_CACHE_TTL_SEC, async () => {
      const settled = await Promise.allSettled(
        carriers.map((carrier) =>
          this.withTimeout(
            this.adapters
              .forCode(carrier.code)
              .getRate(this.carrierContext(carrier), req),
            5000,
          ).then((quote) => ({ carrierId: carrier.id, ...quote })),
        ),
      );
      const quotes = settled
        .filter(
          (s): s is PromiseFulfilledResult<RateQuote & { carrierId: string }> =>
            s.status === 'fulfilled',
        )
        .map((s) => s.value)
        .sort((a, b) => a.amount - b.amount);
      return { quotes };
    });
  }

  // ── Webhook: carrier tracking update ──────────────────────────

  /**
   * Apply a normalized tracking update from a carrier webhook. Status only ever
   * moves forward (or to failed/returned). On `delivered`/`failed` the linked
   * delivery note is synced (§1.5 completion / failure). A domain event is
   * recorded in the same transaction via the outbox.
   *
   * The HMAC signature is verified by the controller before this runs.
   */
  async applyTrackingUpdate(
    tenantId: string,
    carrierId: string,
    dto: TrackingWebhookDto,
  ): Promise<{ accepted: boolean; status?: string }> {
    const mapped = normalizeCarrierStatus(dto.status);
    if (!mapped) {
      // Record the raw event but don't change status on an unknown code.
      const shipment = await this.prisma.shipment.findFirst({
        where: { tenantId, carrierId, trackingNumber: dto.trackingNumber },
        select: { id: true, status: true },
      });
      if (shipment) {
        await this.prisma.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            status: shipment.status,
            description:
              dto.description ?? `Unmapped carrier status: ${dto.status}`,
            location: dto.location ?? null,
            eventTime: dto.eventTime ? new Date(dto.eventTime) : new Date(),
            rawData: dto as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return { accepted: false };
    }

    type TrackingUpdateResult = {
      accepted: boolean;
      status?: string;
      changed?: boolean;
      dnId?: string;
    };
    const result: TrackingUpdateResult = await this.prisma.$transaction(
      async (tx): Promise<TrackingUpdateResult> => {
        const shipment = await tx.shipment.findFirst({
          where: { tenantId, carrierId, trackingNumber: dto.trackingNumber },
        });
        if (!shipment) return { accepted: false };

        const eventTime = dto.eventTime ? new Date(dto.eventTime) : new Date();
        // Always log the raw event for the timeline.
        await tx.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            status: mapped,
            description: dto.description ?? null,
            location: dto.location ?? null,
            eventTime,
            rawData: dto as unknown as Prisma.InputJsonValue,
          },
        });

        // No-op / regressive update: keep the event, leave status alone.
        if (!canTransition(shipment.status, mapped)) {
          return { accepted: true, status: shipment.status, changed: false };
        }

        const data: Prisma.ShipmentUpdateInput = { status: mapped };
        if (mapped === 'delivered') data.actualDelivery = eventTime;
        if (mapped === 'failed') {
          data.failureReason = (
            dto.description ?? 'carrier_reported_failure'
          ).slice(0, 255);
        }
        // Guarded status claim so concurrent webhooks can't double-apply.
        const claim = await tx.shipment.updateMany({
          where: { id: shipment.id, status: shipment.status },
          data,
        });
        if (claim.count === 0) {
          return { accepted: true, status: shipment.status, changed: false };
        }

        await this.outbox.record(tx, {
          tenantId,
          aggregateType: 'Shipment',
          aggregateId: shipment.id,
          eventType: EVENT.SHIPMENT_TRACKING_UPDATED,
          payload: {
            shipmentId: shipment.id,
            dnId: shipment.dnId,
            status: mapped,
            trackingNumber: shipment.trackingNumber,
            eventTime: eventTime.toISOString(),
          },
        });

        return {
          accepted: true,
          status: mapped,
          changed: true,
          dnId: shipment.dnId,
        };
      },
    );

    // DN sync happens in its own transaction (the DN service owns the §1.5
    // side effects). Done after commit so the shipment status is durable first.
    if (result.changed && result.dnId) {
      const dnId = result.dnId;
      try {
        if (mapped === 'delivered') {
          await this.deliveryNotes.completeFromShipment(tenantId, dnId);
        } else if (mapped === 'failed') {
          await this.deliveryNotes.failFromShipment(
            tenantId,
            dnId,
            dto.description ?? 'carrier_reported_failure',
          );
        }
      } catch (err) {
        // DN may already be in a terminal state (idempotent webhook retries) —
        // the shipment status is authoritative; log and move on.
        this.logger.warn(
          `DN ${dnId} sync for shipment status ${mapped} skipped: ${(err as Error).message}`,
        );
      }
    }

    return { accepted: result.accepted, status: result.status };
  }

  /**
   * Resolve the tenant + webhook secret for an inbound (public, tenant-less)
   * carrier webhook. The carrier id in the URL is the only tenant anchor, so we
   * look it up globally (RLS passes when no tenant context is set).
   */
  async resolveWebhookCarrier(
    carrierId: string,
  ): Promise<{ tenantId: string; webhookSecret: string | null } | null> {
    const carrier = await this.prisma.carrier.findUnique({
      where: { id: carrierId },
      select: { tenantId: true, webhookSecret: true, isActive: true },
    });
    if (!carrier || !carrier.isActive) return null;
    return { tenantId: carrier.tenantId, webhookSecret: carrier.webhookSecret };
  }

  // ── Helpers ───────────────────────────────────────────────────

  private carrierContext(carrier: {
    apiKeyEncrypted: string | null;
    apiEndpoint: string | null;
    config: Prisma.JsonValue | null;
  }): CarrierContext {
    return {
      apiKey: PiiCrypto.decryptOptional(carrier.apiKeyEncrypted),
      apiEndpoint: carrier.apiEndpoint,
      config: (carrier.config as Record<string, unknown> | null) ?? null,
    };
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('CARRIER_RATE_TIMEOUT')),
        ms,
      );
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private async require(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, trackingNumber: true },
    });
    if (!shipment) throw new NotFoundException('SHP_SHIPMENT_NOT_FOUND');
    return shipment;
  }
}
