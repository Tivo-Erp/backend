import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CurrentUser,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { FieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { SALES_ORDER_FIELD_CONFIG } from '../config/sales-order.field-config.js';
import { SalesOrderService } from '../services/sales-order.service.js';
import {
  CreateSalesOrderDto,
  SalesOrderQueryDto,
} from '../dto/sales-order.dto.js';

@ApiTags('Sales — Sales Orders')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('sales/sales-orders')
export class SalesOrderController {
  constructor(private readonly service: SalesOrderService) {}

  @Post()
  @RequirePermissions('sal:so:create')
  @ApiOperation({
    summary: 'Create sales order (auto-numbered, server-side totals)',
  })
  @ApiResponse({
    status: 404,
    description: 'Customer / warehouse / item not found',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesOrderDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('sal:so:read')
  @ApiOperation({ summary: 'List sales orders' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(SALES_ORDER_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: SalesOrderQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('sal:so:read')
  @ApiOperation({ summary: 'Get sales order with lines' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(SALES_ORDER_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'SO not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Post(':id/confirm')
  @RequirePermissions('sal:so:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm SO — credit check + stock reservation (draft → approved | pending_approval)',
  })
  @ApiResponse({ status: 400, description: 'Insufficient stock' })
  @ApiResponse({ status: 409, description: 'SO not in draft' })
  confirm(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.confirm(tenantId, id);
  }

  @Post(':id/approve')
  @RequirePermissions('sal:so:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve credit-held SO (pending_approval → approved)',
  })
  @ApiResponse({ status: 409, description: 'SO not pending approval' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approve(tenantId, id, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermissions('sal:so:cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel SO (draft/confirmed/pending_approval/approved → cancelled) — releases stock reservations and applied credit',
  })
  @ApiResponse({ status: 404, description: 'SO not found' })
  @ApiResponse({
    status: 409,
    description:
      'SO already shipped (SAL_SO_ALREADY_SHIPPED) or not in a cancellable status (SAL_SO_NOT_CANCELLABLE)',
  })
  cancel(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(tenantId, id);
  }
}
