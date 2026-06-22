import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { CUSTOMER_FIELD_CONFIG } from '../config/customer.field-config.js';
import { CustomerRepository } from '../repositories/customer.repository.js';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from '../dto/customer.dto.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async create(tenantId: string, dto: CreateCustomerDto) {
    const exists = await this.repo.findByCode(tenantId, dto.code);
    if (exists) throw new ConflictException('SAL_CUSTOMER_CODE_DUPLICATE');
    return this.repo.create(tenantId, dto);
  }

  async findAll(
    tenantId: string,
    query: CustomerQueryDto,
    userRoles: string[],
  ) {
    const select = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      CUSTOMER_FIELD_CONFIG,
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
      CUSTOMER_FIELD_CONFIG,
    );
    const customer = await this.repo.findById(tenantId, id, select);
    if (!customer) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');
    return customer;
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    const customer = await this.repo.findById(tenantId, id, {
      id: true,
      code: true,
    });
    if (!customer) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');

    if (dto.code && dto.code !== customer.code) {
      const conflict = await this.repo.findByCode(tenantId, dto.code);
      if (conflict && conflict.id !== id)
        throw new ConflictException('SAL_CUSTOMER_CODE_DUPLICATE');
    }

    return this.repo.update(tenantId, id, dto);
  }

  async deactivate(tenantId: string, id: string) {
    const customer = await this.repo.findById(tenantId, id, { id: true });
    if (!customer) throw new NotFoundException('SAL_CUSTOMER_NOT_FOUND');
    return this.repo.update(tenantId, id, { isActive: false });
  }
}
