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
import { CUSTOMER_FIELD_CONFIG } from '../config/customer.field-config.js';
import { CustomerService } from '../services/customer.service.js';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  UpdateCustomerDto,
} from '../dto/customer.dto.js';

@ApiTags('Sales — Customers')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('sales/customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Post()
  @RequirePermissions('sal:customer:create')
  @ApiOperation({ summary: 'Create customer' })
  @ApiResponse({ status: 409, description: 'Customer code duplicate' })
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCustomerDto) {
    return this.service.create(tenantId, dto);
  }

  @Get()
  @RequirePermissions('sal:customer:read')
  @ApiOperation({ summary: 'List customers' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(CUSTOMER_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: CustomerQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('sal:customer:read')
  @ApiOperation({ summary: 'Get customer by ID' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(CUSTOMER_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('sal:customer:update')
  @ApiOperation({ summary: 'Update customer' })
  @ApiResponse({ status: 409, description: 'Customer code duplicate' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('sal:customer:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate customer' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.deactivate(tenantId, id);
  }
}
