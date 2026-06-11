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
  CurrentUser,
  CurrentUserRoles,
  RequirePermissions,
} from '../../../common/decorators/index.js';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface.js';
import { PURCHASE_ORDER_FIELD_CONFIG } from '../config/purchase-order.field-config.js';
import { PurchaseOrderService } from '../services/purchase-order.service.js';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderQueryDto,
  UpdatePurchaseOrderDto,
} from '../dto/purchase-order.dto.js';

@ApiTags('Purchase — Purchase Orders')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('api/v1/purchase/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly service: PurchaseOrderService) {}

  @Post()
  @RequirePermissions('pur:po:create')
  @ApiOperation({
    summary: 'Create purchase order (auto-numbered, server-side totals)',
  })
  @ApiResponse({ status: 201, description: 'PO created' })
  @ApiResponse({
    status: 404,
    description: 'Supplier / warehouse / branch / item not found',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.service.create(tenantId, user.sub, dto);
  }

  @Get()
  @RequirePermissions('pur:po:read')
  @ApiOperation({ summary: 'List purchase orders' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(PURCHASE_ORDER_FIELD_CONFIG),
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: PurchaseOrderQueryDto,
  ) {
    return this.service.findAll(tenantId, query, roles);
  }

  @Get(':id')
  @RequirePermissions('pur:po:read')
  @ApiOperation({ summary: 'Get purchase order with lines' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(PURCHASE_ORDER_FIELD_CONFIG),
  })
  @ApiResponse({ status: 404, description: 'PO not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.service.findOne(tenantId, id, roles, query.fields);
  }

  @Patch(':id')
  @RequirePermissions('pur:po:update')
  @ApiOperation({
    summary: 'Update purchase order header and/or replace lines (draft only)',
  })
  @ApiResponse({ status: 404, description: 'PO not found' })
  @ApiResponse({ status: 409, description: 'PO not in draft' })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.service.update(tenantId, id, user.sub, dto);
  }

  @Delete(':id')
  @RequirePermissions('pur:po:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete purchase order (draft only)' })
  @ApiResponse({ status: 404, description: 'PO not found' })
  @ApiResponse({ status: 409, description: 'PO not in draft' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.service.remove(tenantId, id);
  }

  @Post(':id/submit')
  @RequirePermissions('pur:po:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit PO for approval (draft → pending_approval)',
  })
  @ApiResponse({ status: 409, description: 'PO not in draft' })
  submit(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.submit(tenantId, id);
  }

  @Post(':id/approve')
  @RequirePermissions('pur:po:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve PO (pending_approval → approved)' })
  @ApiResponse({ status: 409, description: 'PO not pending approval' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approve(tenantId, id, user.sub);
  }

  @Post(':id/cancel')
  @RequirePermissions('pur:po:cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel PO (only if no goods receipt linked)' })
  @ApiResponse({ status: 409, description: 'PO has GRN or not cancellable' })
  cancel(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.cancel(tenantId, id);
  }
}
