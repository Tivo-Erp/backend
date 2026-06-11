import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RbacGuard } from '../../../common/guards/rbac.guard.js';
import { TenantGuard } from '../../../common/guards/tenant.guard.js';
import {
  CurrentTenant,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import { SUPPLIER_FIELD_CONFIG } from '../config/supplier.field-config.js';
import { SupplierService } from '../services/supplier.service.js';
import {
  CreateSupplierDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from '../dto/supplier.dto.js';

@ApiTags('Purchase — Suppliers')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/purchase/suppliers')
export class SupplierController {
  constructor(private readonly service: SupplierService) {}

  @Post()
  @RequirePermissions('pur:supplier:create')
  @ApiOperation({ summary: 'Create supplier' })
  @ApiResponse({ status: 201, description: 'Supplier created' })
  @ApiResponse({ status: 409, description: 'Supplier code duplicate' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateSupplierDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('pur:supplier:read')
  @ApiOperation({ summary: 'List suppliers' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(SUPPLIER_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: SupplierQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('pur:supplier:read')
  @ApiOperation({ summary: 'Get supplier by ID' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(SUPPLIER_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('pur:supplier:update')
  @ApiOperation({ summary: 'Update supplier' })
  @ApiResponse({ status: 409, description: 'Supplier code duplicate' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('pur:supplier:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate supplier' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deactivate(tenantId, id);
  }
}
