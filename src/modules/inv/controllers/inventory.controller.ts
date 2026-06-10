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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard.js';
import { RbacGuard } from 'src/common/guards/rbac.guard.js';
import { TenantGuard } from 'src/common/guards/tenant.guard.js';
import { CurrentTenant, CurrentUser, RequirePermissions } from 'src/common/decorators/index.js';
import type { JwtPayload } from 'src/modules/auth/interfaces/jwt-payload.interface.js';
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
  findBalances(
    @CurrentTenant() tenantId: string,
    @Query() query: InventoryQueryDto,
  ) {
    return this.inventoryService.findBalances(tenantId, query);
  }

  // ── INV-001: Movement History ─────────────────────────────────

  @Get('movements')
  @RequirePermissions('inv:movement:read')
  @ApiOperation({ summary: 'View stock movement history with date range' })
  findMovements(
    @CurrentTenant() tenantId: string,
    @Query() query: MovementQueryDto,
  ) {
    return this.inventoryService.findMovements(tenantId, query);
  }

  // ── INV-002: Stock Adjustment ─────────────────────────────────

  @Post('adjustments')
  @RequirePermissions('inv:stock:adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manual stock adjustment (count variance, damage, initial stock)' })
  @ApiResponse({ status: 400, description: 'Negative stock or lot required' })
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
  @ApiResponse({ status: 400, description: 'Same warehouse or insufficient stock' })
  createTransfer(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.inventoryService.createTransfer(tenantId, user.sub, dto);
  }
}
