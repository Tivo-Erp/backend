import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { SUPPLIER_FIELD_CONFIG } from '../config/supplier.field-config.js';
import { SupplierRepository } from '../repositories/supplier.repository.js';
import {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from '../dto/supplier.dto.js';

@Injectable()
export class SupplierService {
  constructor(private readonly repo: SupplierRepository) {}

  async create(tenantId: string, dto: CreateSupplierDto) {
    const exists = await this.repo.findByCode(tenantId, dto.code);
    if (exists) throw new ConflictException('PUR_SUPPLIER_CODE_DUPLICATE');
    try {
      return await this.repo.create(tenantId, dto);
    } catch (e) {
      throw this.mapDuplicateCode(e);
    }
  }

  /** Converts a P2002 unique-constraint race into the same 409 as the pre-check. */
  private mapDuplicateCode(e: unknown): Error {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException('PUR_SUPPLIER_CODE_DUPLICATE');
    }
    return e as Error;
  }

  async findAll(
    tenantId: string,
    query: SupplierQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      SUPPLIER_FIELD_CONFIG,
    );
    const { data, total, page, limit } = await this.repo.findAll(
      tenantId,
      query,
      select,
    );
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
      SUPPLIER_FIELD_CONFIG,
    );
    const supplier = await this.repo.findById(tenantId, id, select);
    if (!supplier) throw new NotFoundException('PUR_SUPPLIER_NOT_FOUND');
    return supplier;
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
    const supplier = await this.repo.findById(tenantId, id, {
      id: true,
      code: true,
    });
    if (!supplier) throw new NotFoundException('PUR_SUPPLIER_NOT_FOUND');

    if (dto.code && dto.code !== supplier.code) {
      const conflict = await this.repo.findByCode(tenantId, dto.code);
      if (conflict && conflict.id !== id)
        throw new ConflictException('PUR_SUPPLIER_CODE_DUPLICATE');
    }

    try {
      return await this.repo.update(id, dto);
    } catch (e) {
      throw this.mapDuplicateCode(e);
    }
  }

  async deactivate(tenantId: string, id: string) {
    const supplier = await this.repo.findById(tenantId, id, { id: true });
    if (!supplier) throw new NotFoundException('PUR_SUPPLIER_NOT_FOUND');
    return this.repo.update(id, { isActive: false });
  }
}
