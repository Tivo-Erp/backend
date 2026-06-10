import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FieldSelector } from '../../../common/utils/field-selector.js';
import {
  WAREHOUSE_FIELD_CONFIG,
  ZONE_FIELD_CONFIG,
  BIN_FIELD_CONFIG,
} from '../config/warehouse.field-config.js';
import { WarehouseRepository } from '../repositories/warehouse.repository.js';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  CreateZoneDto,
  UpdateZoneDto,
  CreateBinDto,
  UpdateBinDto,
} from '../dto/wms.dto.js';

@Injectable()
export class WarehouseService {
  constructor(private readonly repo: WarehouseRepository) {}

  // ── Warehouse ────────────────────────────────────────────────

  async createWarehouse(tenantId: string, dto: CreateWarehouseDto) {
    const exists = await this.repo.findWarehouseByCode(tenantId, dto.code);
    if (exists) throw new ConflictException('WMS_WAREHOUSE_CODE_DUPLICATE');
    return this.repo.createWarehouse(tenantId, dto);
  }

  async findAllWarehouses(tenantId: string, userRoles: string[], fields?: string) {
    const select = FieldSelector.buildPrismaSelect(fields, userRoles, WAREHOUSE_FIELD_CONFIG);
    return this.repo.findAllWarehouses(tenantId, select);
  }

  async findWarehouseById(tenantId: string, id: string) {
    const wh = await this.repo.findWarehouseById(tenantId, id);
    if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');
    return wh;
  }

  async updateWarehouse(tenantId: string, id: string, dto: UpdateWarehouseDto) {
    await this.repo.assertWarehouseOwnership(tenantId, id);
    return this.repo.updateWarehouse(id, dto);
  }

  async deleteWarehouse(tenantId: string, id: string) {
    await this.repo.assertWarehouseOwnership(tenantId, id);
    const hasStock = await this.repo.hasStock(id);
    if (hasStock) throw new ConflictException('WMS_WAREHOUSE_HAS_STOCK');
    await this.repo.deleteWarehouse(id);
  }

  // ── Zone ─────────────────────────────────────────────────────

  async createZone(tenantId: string, warehouseId: string, dto: CreateZoneDto) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    const exists = await this.repo.findZoneByCode(warehouseId, dto.code);
    if (exists) throw new ConflictException('WMS_ZONE_CODE_DUPLICATE');
    return this.repo.createZone(warehouseId, dto);
  }

  async findZones(tenantId: string, warehouseId: string, userRoles: string[], fields?: string) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    const select = FieldSelector.buildPrismaSelect(fields, userRoles, ZONE_FIELD_CONFIG);
    return this.repo.findZones(warehouseId, select);
  }

  async updateZone(tenantId: string, warehouseId: string, zoneId: string, dto: UpdateZoneDto) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    await this.repo.assertZoneOwnership(warehouseId, zoneId);
    return this.repo.updateZone(zoneId, dto);
  }

  async deleteZone(tenantId: string, warehouseId: string, zoneId: string) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    await this.repo.assertZoneOwnership(warehouseId, zoneId);
    await this.repo.deleteZone(zoneId);
  }

  // ── Bin ──────────────────────────────────────────────────────

  async createBin(tenantId: string, warehouseId: string, zoneId: string, dto: CreateBinDto) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    await this.repo.assertZoneOwnership(warehouseId, zoneId);
    const exists = await this.repo.findBinByBarcode(zoneId, dto.barcode);
    if (exists) throw new ConflictException('WMS_BIN_BARCODE_DUPLICATE');
    return this.repo.createBin(zoneId, dto);
  }

  async findBins(
    tenantId: string,
    warehouseId: string,
    zoneId: string,
    userRoles: string[],
    fields?: string,
  ) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    await this.repo.assertZoneOwnership(warehouseId, zoneId);
    const select = FieldSelector.buildPrismaSelect(fields, userRoles, BIN_FIELD_CONFIG);
    return this.repo.findBins(zoneId, select);
  }

  async updateBin(
    tenantId: string,
    warehouseId: string,
    zoneId: string,
    binId: string,
    dto: UpdateBinDto,
  ) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    await this.repo.assertZoneOwnership(warehouseId, zoneId);
    const bin = await this.repo.findBinById(zoneId, binId);
    if (!bin) throw new NotFoundException('WMS_BIN_NOT_FOUND');
    return this.repo.updateBin(binId, dto);
  }

  async deleteBin(tenantId: string, warehouseId: string, zoneId: string, binId: string) {
    await this.repo.assertWarehouseOwnership(tenantId, warehouseId);
    await this.repo.assertZoneOwnership(warehouseId, zoneId);
    const bin = await this.repo.findBinById(zoneId, binId);
    if (!bin) throw new NotFoundException('WMS_BIN_NOT_FOUND');
    await this.repo.deleteBin(binId);
  }
}
