import { Injectable, HttpStatus } from '@nestjs/common';
import { BranchRepository } from '../repositories/branch.repository.js';
import { CreateBranchDto, UpdateBranchDto } from '../dto/branch.dto.js';
import { PaginationQueryDto, PaginatedResponseDto } from '../../../common/dto/pagination.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { BRANCH_FIELD_CONFIG } from '../config/branch.field-config.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';

@Injectable()
export class BranchService {
  constructor(private readonly branchRepository: BranchRepository) {}

  async create(tenantId: string, dto: CreateBranchDto) {
    const existing = await this.branchRepository.findByTenantAndCode(
      tenantId,
      dto.code,
    );
    if (existing) {
      throw new BusinessException(
        'ORG_BRANCH_CODE_DUPLICATE',
        `Branch code '${dto.code}' already exists`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.isHeadquarters) {
      const existingHQ = await this.branchRepository.findHeadquarters(tenantId);
      if (existingHQ) {
        throw new BusinessException(
          'ORG_BRANCH_HQ_EXISTS',
          'A headquarters branch already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.branchRepository.create({ tenantId, ...dto });
  }

  async findAll(
    tenantId: string,
    query: PaginationQueryDto & { isActive?: boolean; search?: string; fields?: string },
    userRoles: string[],
  ) {
    const prismaSelect = FieldSelector.buildPrismaSelect(
      query.fields,
      userRoles,
      BRANCH_FIELD_CONFIG,
    );

    const { data, total } = await this.branchRepository.findMany(
      tenantId,
      query,
      prismaSelect,
    );

    return PaginatedResponseDto.create(
      data,
      total,
      query.page || 1,
      query.limit || 20,
    );
  }

  async update(tenantId: string, id: string, dto: UpdateBranchDto) {
    const branch = await this.branchRepository.findById(id);
    if (!branch || branch.tenantId !== tenantId) {
      throw new BusinessException(
        'ORG_BRANCH_NOT_FOUND',
        'Branch not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.isHeadquarters) {
      const existingHQ =
        await this.branchRepository.findHeadquarters(tenantId);
      if (existingHQ && existingHQ.id !== id) {
        throw new BusinessException(
          'ORG_BRANCH_HQ_EXISTS',
          'A headquarters branch already exists',
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.branchRepository.update(id, dto);
  }

  async delete(tenantId: string, id: string) {
    const branch = await this.branchRepository.findById(id);
    if (!branch || branch.tenantId !== tenantId) {
      throw new BusinessException(
        'ORG_BRANCH_NOT_FOUND',
        'Branch not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return this.branchRepository.delete(id);
  }
}
