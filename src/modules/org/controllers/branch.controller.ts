import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiParam, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { BranchService } from '../services/branch.service.js';
import { CreateBranchDto, UpdateBranchDto } from '../dto/branch.dto.js';
import { CurrentTenant, CurrentUserRoles, RequirePermissions } from '../../../common/decorators/index.js';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { BRANCH_FIELD_CONFIG } from '../config/branch.field-config.js';
import { IsOptional, IsBoolean, IsString } from 'class-validator';
import { Type } from 'class-transformer';

class BranchQueryDto extends PaginatedFieldsQueryDto {
  /** Filter by active status */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  /** Full-text search on branch name/code */
  @IsOptional()
  @IsString()
  search?: string;
}

@ApiTags('Org — Branches')
@ApiBearerAuth('JWT-Auth')
@Controller('api/v1/org/branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Post()
  @RequirePermissions('org:branch:create')
  @ApiOperation({ summary: 'Create Branch', description: 'Create a new branch under current tenant. Requires `org:branch:create` permission.' })
  @ApiBody({ type: CreateBranchDto })
  @ApiResponse({ status: 201, description: 'Branch created' })
  @ApiResponse({ status: 409, description: 'Branch code already exists' })
  async create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchService.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('org:branch:read')
  @ApiOperation({ summary: 'List Branches', description: 'Paginated list of branches with Sparse Fieldsets support.' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(BRANCH_FIELD_CONFIG),
    example: 'id,code,name,city',
  })
  @ApiResponse({ status: 200, description: 'Paginated branches with selected fields' })
  async findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() userRoles: string[],
    @Query() query: BranchQueryDto,
  ) {
    return this.branchService.findAll(tenantId, query, userRoles);
  }

  @Patch(':id')
  @RequirePermissions('org:branch:update')
  @ApiOperation({ summary: 'Update Branch', description: 'Partial update of a branch.' })
  @ApiParam({ name: 'id', description: 'Branch UUID', format: 'uuid' })
  @ApiBody({ type: UpdateBranchDto })
  @ApiResponse({ status: 200, description: 'Branch updated' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org:branch:delete')
  @ApiOperation({ summary: 'Delete Branch', description: 'Soft-delete a branch.' })
  @ApiParam({ name: 'id', description: 'Branch UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Branch deleted' })
  @ApiResponse({ status: 404, description: 'Branch not found' })
  async delete(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.branchService.delete(tenantId, id);
  }
}
