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
import {
  WAREHOUSE_FIELD_CONFIG,
  ZONE_FIELD_CONFIG,
  BIN_FIELD_CONFIG,
} from '../config/warehouse.field-config.js';
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
  @ApiResponse({ status: 201, description: 'Warehouse created' })
  @ApiResponse({ status: 409, description: 'Code duplicate' })
  createWarehouse(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateWarehouseDto,
  ) {
    return this.warehouseService.createWarehouse(tenantId, dto);
  }

  @Get()
  @RequirePermissions('wms:warehouse:read')
  @ApiOperation({ summary: 'List all warehouses' })
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(WAREHOUSE_FIELD_CONFIG),
  })
  findAllWarehouses(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.warehouseService.findAllWarehouses(
      tenantId,
      roles,
      query.fields,
    );
  }

  @Get(':id')
  @RequirePermissions('wms:warehouse:read')
  @ApiOperation({ summary: 'Get warehouse with zones and bins' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
  findWarehouse(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.warehouseService.findWarehouseById(tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('wms:warehouse:update')
  @ApiOperation({ summary: 'Update warehouse' })
  @ApiResponse({ status: 200, description: 'Warehouse updated' })
  @ApiResponse({ status: 404, description: 'Warehouse not found' })
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
  @ApiResponse({ status: 204, description: 'Warehouse deleted' })
  @ApiResponse({ status: 409, description: 'Has stock — cannot delete' })
  deleteWarehouse(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.warehouseService.deleteWarehouse(tenantId, id);
  }

  // ── Zones ────────────────────────────────────────────────────

  @Post(':whId/zones')
  @RequirePermissions('wms:zone:create')
  @ApiOperation({ summary: 'Create zone in warehouse' })
  @ApiResponse({ status: 201, description: 'Zone created' })
  @ApiResponse({ status: 409, description: 'Zone code duplicate' })
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
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(ZONE_FIELD_CONFIG),
  })
  findZones(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('whId', ParseUUIDPipe) whId: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.warehouseService.findZones(tenantId, whId, roles, query.fields);
  }

  @Patch(':whId/zones/:zoneId')
  @RequirePermissions('wms:zone:update')
  @ApiOperation({ summary: 'Update zone' })
  @ApiResponse({ status: 200, description: 'Zone updated' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
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
  @ApiResponse({ status: 204, description: 'Zone deleted' })
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
  @ApiResponse({ status: 201, description: 'Bin created' })
  @ApiResponse({ status: 409, description: 'Barcode duplicate' })
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
  @ApiQuery({
    name: 'fields',
    required: false,
    description: FieldSelector.describeForSwagger(BIN_FIELD_CONFIG),
  })
  findBins(
    @CurrentTenant() tenantId: string,
    @CurrentUserRoles() roles: string[],
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Query() query: PaginatedFieldsQueryDto,
  ) {
    return this.warehouseService.findBins(
      tenantId,
      whId,
      zoneId,
      roles,
      query.fields,
    );
  }

  @Patch(':whId/zones/:zoneId/bins/:binId')
  @RequirePermissions('wms:bin:update')
  @ApiOperation({ summary: 'Update bin' })
  @ApiResponse({ status: 200, description: 'Bin updated' })
  @ApiResponse({ status: 404, description: 'Bin not found' })
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
  @ApiResponse({ status: 204, description: 'Bin deleted' })
  deleteBin(
    @CurrentTenant() tenantId: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Param('binId', ParseUUIDPipe) binId: string,
  ) {
    return this.warehouseService.deleteBin(tenantId, whId, zoneId, binId);
  }
}
