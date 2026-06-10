import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { BALANCE_FIELD_CONFIG } from '../config/balance.field-config.js';
import { MOVEMENT_FIELD_CONFIG } from '../config/movement.field-config.js';
import { InventoryService } from '../services/inventory.service.js';
import {
  InventoryQueryDto,
  MovementQueryDto,
  CreateStockAdjustmentDto,
  CreateStockTransferDto,
} from '../dto/inv.dto.js';

@ApiTags('Inventory')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ── INV-001: Stock Balances ───────────────────────────────────

  @Get('balances')
  @RequirePermissions('inv:stock:read')
  @ApiOperation({ summary: 'Query current stock balances with filters' })
  @ApiQuery({ name: 'fields', required: false, description: FieldSelector.describeForSwagger(BALANCE_FIELD_CONFIG) })
  @ApiResponse({ status: 200, description: 'Paginated stock balances' })
  findBalances(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventoryService.findBalances(tenantId, query, roles);
  }

  // ── INV-001: Movement History ─────────────────────────────────

  @Get('movements')
  @RequirePermissions('inv:movement:read')
  @ApiOperation({ summary: 'View stock movement history with date range' })
  @ApiQuery({ name: 'fields', required: false, description: FieldSelector.describeForSwagger(MOVEMENT_FIELD_CONFIG) })
  @ApiResponse({ status: 200, description: 'Paginated movement history' })
  findMovements(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: MovementQueryDto,
    @Query() fieldsQuery: PaginatedFieldsQueryDto,
  ) {
    return this.inventoryService.findMovements(tenantId, query, roles, fieldsQuery.fields);
  }

  // ── INV-002: Stock Adjustment ─────────────────────────────────

  @Post('adjustments')
  @RequirePermissions('inv:stock:adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual stock adjustment (count variance, damage, initial stock)' })
  @ApiResponse({ status: 200, description: 'Adjustment applied' })
  @ApiResponse({ status: 400, description: 'Negative stock or lot required' })
  @ApiResponse({ status: 404, description: 'Warehouse or item not found' })
  createAdjustment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockAdjustmentDto,
  ) {
    return this.inventoryService.createAdjustment(tenantId, user.sub, dto);
  }

  // ── INV-003: Stock Transfer ───────────────────────────────────

  @Post('transfers')
  @RequirePermissions('wms:transfer:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transfer stock between warehouses' })
  @ApiResponse({ status: 200, description: 'Transfer completed' })
  @ApiResponse({ status: 400, description: 'Same warehouse or insufficient stock' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  createTransfer(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.inventoryService.createTransfer(tenantId, user.sub, dto);
  }
}
