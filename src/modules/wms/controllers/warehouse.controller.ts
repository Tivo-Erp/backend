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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard.js';
import { RbacGuard } from 'src/common/guards/rbac.guard.js';
import { TenantGuard } from 'src/common/guards/tenant.guard.js';
import { CurrentTenant, RequirePermissions } from 'src/common/decorators/index.js';
import { WarehouseService } from '../services/warehouse.service.js';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  CreateZoneDto,
  UpdateZoneDto,
  CreateBinDto,
  UpdateBinDto,
} from '../dto/wms.dto.js';

@ApiTags('WMS — Warehouses')
@ApiBearerAuth('JWT-Auth')
@UseGuards(JwtAuthGuard, TenantGuard, RbacGuard)
@Controller('warehouse/warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  // ── Warehouses ───────────────────────────────────────────────

  @Post()
  @RequirePermissions('wms:warehouse:create')
  @ApiOperation({ summary: 'Create warehouse' })
  @ApiResponse({ status: 201 }) @ApiResponse({ status: 409, description: 'Code duplicate' })
  createWarehouse(@CurrentTenant() tenantId: string, @Body() dto: CreateWarehouseDto) {
    return this.warehouseService.createWarehouse(tenantId, dto);
  }

  @Get()
  @RequirePermissions('wms:warehouse:read')
  @ApiOperation({ summary: 'List all warehouses' })
  findAllWarehouses(@CurrentTenant() tenantId: string) {
    return this.warehouseService.findAllWarehouses(tenantId);
  }

  @Get(':id')
  @RequirePermissions('wms:warehouse:read')
  @ApiOperation({ summary: 'Get warehouse with zones and bins' })
  findWarehouse(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseService.findWarehouseById(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('wms:warehouse:update')
  @ApiOperation({ summary: 'Update warehouse' })
  updateWarehouse(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.warehouseService.updateWarehouse(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('wms:warehouse:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete warehouse (only if no stock)' })
  @ApiResponse({ status: 409, description: 'Has stock — cannot delete' })
  deleteWarehouse(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.warehouseService.deleteWarehouse(tenantId, id);
  }

  // ── Zones ────────────────────────────────────────────────────

  @Post(':whId/zones')
  @RequirePermissions('wms:zone:create')
  @ApiOperation({ summary: 'Create zone in warehouse' })
  createZone(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Body() dto: CreateZoneDto,
  ) {
    return this.warehouseService.createZone(tenantId, whId, dto);
  }

  @Get(':whId/zones')
  @RequirePermissions('wms:zone:read')
  @ApiOperation({ summary: 'List zones in warehouse' })
  findZones(@CurrentTenant() tenantId: string, @Param('whId', ParseUUIDPipe) whId: string) {
    return this.warehouseService.findZones(tenantId, whId);
  }

  @Patch(':whId/zones/:zoneId')
  @RequirePermissions('wms:zone:update')
  @ApiOperation({ summary: 'Update zone' })
  updateZone(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: UpdateZoneDto,
  ) {
    return this.warehouseService.updateZone(tenantId, whId, zoneId, dto);
  }

  @Delete(':whId/zones/:zoneId')
  @RequirePermissions('wms:zone:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete zone' })
  deleteZone(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
  ) {
    return this.warehouseService.deleteZone(tenantId, whId, zoneId);
  }

  // ── Bins ─────────────────────────────────────────────────────

  @Post(':whId/zones/:zoneId/bins')
  @RequirePermissions('wms:bin:create')
  @ApiOperation({ summary: 'Create bin in zone' })
  createBin(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() dto: CreateBinDto,
  ) {
    return this.warehouseService.createBin(tenantId, whId, zoneId, dto);
  }

  @Get(':whId/zones/:zoneId/bins')
  @RequirePermissions('wms:bin:read')
  @ApiOperation({ summary: 'List bins in zone' })
  findBins(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
  ) {
    return this.warehouseService.findBins(tenantId, whId, zoneId);
  }

  @Patch(':whId/zones/:zoneId/bins/:binId')
  @RequirePermissions('wms:bin:update')
  @ApiOperation({ summary: 'Update bin' })
  updateBin(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Param('binId', ParseUUIDPipe) binId: string,
    @Body() dto: UpdateBinDto,
  ) {
    return this.warehouseService.updateBin(tenantId, whId, zoneId, binId, dto);
  }

  @Delete(':whId/zones/:zoneId/bins/:binId')
  @RequirePermissions('wms:bin:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete bin' })
  deleteBin(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Param('binId', ParseUUIDPipe) binId: string,
  ) {
    return this.warehouseService.deleteBin(tenantId, whId, zoneId, binId);
  }
}
