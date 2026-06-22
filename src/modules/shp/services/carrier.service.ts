import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { safeSortBy } from '../../../common/utils/sort.util.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { CARRIER_FIELD_CONFIG } from '../config/shp.field-config.js';
import {
  CarrierQueryDto,
  CreateCarrierDto,
  UpdateCarrierDto,
} from '../dto/carrier.dto.js';

const CARRIER_SORTABLE = ['createdAt', 'updatedAt', 'code', 'name'] as const;

/** Shipment statuses that count as "active" — block carrier deletion. */
const ACTIVE_SHIPMENT_STATUSES = [
  'created',
  'label_printed',
  'picked_up',
  'in_transit',
  'out_for_delivery',
];

@Injectable()
export class CarrierService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateCarrierDto) {
    try {
      return await this.prisma.carrier.create({
        data: {
          tenantId,
          code: dto.code,
          name: dto.name,
          apiEndpoint: dto.apiEndpoint ?? null,
          apiKeyEncrypted: PiiCrypto.encryptOptional(dto.apiKey),
          webhookSecret: dto.webhookSecret ?? null,
          config: (dto.config ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          isActive: dto.isActive ?? true,
        },
        select: this.safeSelect(),
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('SHP_CARRIER_CODE_TAKEN');
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateCarrierDto) {
    await this.require(tenantId, id);
    const data: Prisma.CarrierUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.apiEndpoint !== undefined) data.apiEndpoint = dto.apiEndpoint;
    if (dto.apiKey !== undefined) {
      data.apiKeyEncrypted = PiiCrypto.encryptOptional(dto.apiKey);
    }
    if (dto.webhookSecret !== undefined) data.webhookSecret = dto.webhookSecret;
    if (dto.config !== undefined) {
      data.config = (dto.config ?? Prisma.JsonNull) as Prisma.InputJsonValue;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    await this.prisma.carrier.update({ where: { id }, data });
    return this.findOne(tenantId, id, ['tenant_owner']);
  }

  async findAll(tenantId: string, query: CarrierQueryDto, roles: string[]) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      roles,
      CARRIER_FIELD_CONFIG,
    );
    const {
      page = 1,
      limit = 20,
      sortOrder = 'desc',
      isActive,
      search,
    } = query;
    const sortBy = safeSortBy(query.sortBy, CARRIER_SORTABLE);

    const where: Prisma.CarrierWhereInput = {
      tenantId,
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.carrier.findMany({
        where,
        select,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.carrier.count({ where }),
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
      CARRIER_FIELD_CONFIG,
    );
    const carrier = await this.prisma.carrier.findFirst({
      where: { id, tenantId },
      select,
    });
    if (!carrier) throw new NotFoundException('SHP_CARRIER_NOT_FOUND');
    return carrier;
  }

  async remove(tenantId: string, id: string) {
    await this.require(tenantId, id);
    const active = await this.prisma.shipment.count({
      where: {
        tenantId,
        carrierId: id,
        status: { in: ACTIVE_SHIPMENT_STATUSES },
      },
    });
    if (active > 0) {
      throw new ConflictException('SHP_CARRIER_HAS_ACTIVE_SHIPMENTS');
    }
    // Hard delete is safe only with no shipments at all (FK is RESTRICT);
    // otherwise deactivate to preserve historical shipment references.
    const total = await this.prisma.shipment.count({
      where: { tenantId, carrierId: id },
    });
    if (total > 0) {
      await this.prisma.carrier.update({
        where: { id },
        data: { isActive: false },
      });
      return { id, deactivated: true };
    }
    await this.prisma.carrier.delete({ where: { id } });
    return { id, deleted: true };
  }

  /** Internal: load a carrier with its decrypted API key for adapter calls. */
  async loadForAdapter(tenantId: string, id: string) {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id, tenantId },
    });
    if (!carrier) throw new NotFoundException('SHP_CARRIER_NOT_FOUND');
    return {
      ...carrier,
      apiKey: PiiCrypto.decryptOptional(carrier.apiKeyEncrypted),
    };
  }

  private async require(tenantId: string, id: string) {
    const carrier = await this.prisma.carrier.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!carrier) throw new NotFoundException('SHP_CARRIER_NOT_FOUND');
    return carrier;
  }

  /** A select that can never leak the encrypted key / webhook secret. */
  private safeSelect(): Prisma.CarrierSelect {
    return {
      id: true,
      code: true,
      name: true,
      apiEndpoint: true,
      config: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}
