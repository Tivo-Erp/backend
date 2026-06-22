import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  CreateZoneDto,
  UpdateZoneDto,
  CreateBinDto,
  UpdateBinDto,
} from '../dto/wms.dto.js';

@Injectable()
export class WarehouseRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Warehouse ────────────────────────────────────────────────

  async findWarehouseByCode(tenantId: string, code: string) {
    return this.prisma.warehouse.findFirst({ where: { tenantId, code } });
  }

  async createWarehouse(tenantId: string, dto: CreateWarehouseDto) {
    return this.prisma.warehouse.create({ data: { tenantId, ...dto } });
  }

  async findAllWarehouses(tenantId: string, select: Record<string, any>) {
    return this.prisma.warehouse.findMany({
      where: { tenantId },
      select,
      orderBy: { code: 'asc' },
    });
  }

  async findWarehouseById(tenantId: string, id: string) {
    return this.prisma.warehouse.findFirst({
      where: { id, tenantId },
      include: { zones: { include: { bins: true } } },
    });
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto) {
    return this.prisma.warehouse.update({ where: { id }, data: dto });
  }

  async hasStock(warehouseId: string) {
    return this.prisma.inventoryBalance.findFirst({
      where: { warehouseId, quantityOnHand: { gt: 0 } },
    });
  }

  async deleteWarehouse(id: string) {
    return this.prisma.warehouse.delete({ where: { id } });
  }

  async assertWarehouseOwnership(tenantId: string, warehouseId: string) {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
    });
    if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');
    return wh;
  }

  // ── Zone ─────────────────────────────────────────────────────

  async findZoneByCode(warehouseId: string, code: string) {
    return this.prisma.zone.findFirst({ where: { warehouseId, code } });
  }

  async createZone(warehouseId: string, dto: CreateZoneDto) {
    return this.prisma.zone.create({ data: { warehouseId, ...dto } });
  }

  async findZones(warehouseId: string, select: Record<string, any>) {
    return this.prisma.zone.findMany({
      where: { warehouseId },
      select,
      orderBy: { code: 'asc' },
    });
  }

  async assertZoneOwnership(warehouseId: string, zoneId: string) {
    const zone = await this.prisma.zone.findFirst({
      where: { id: zoneId, warehouseId },
    });
    if (!zone) throw new NotFoundException('WMS_ZONE_NOT_FOUND');
    return zone;
  }

  async updateZone(zoneId: string, dto: UpdateZoneDto) {
    return this.prisma.zone.update({ where: { id: zoneId }, data: dto });
  }

  async deleteZone(zoneId: string) {
    return this.prisma.zone.delete({ where: { id: zoneId } });
  }

  // ── Bin ──────────────────────────────────────────────────────

  async findBinByBarcode(zoneId: string, barcode: string) {
    return this.prisma.bin.findFirst({ where: { zoneId, barcode } });
  }

  async createBin(zoneId: string, dto: CreateBinDto) {
    return this.prisma.bin.create({ data: { zoneId, ...dto } });
  }

  async findBins(zoneId: string, select: Record<string, any>) {
    return this.prisma.bin.findMany({
      where: { zoneId },
      select,
      orderBy: { barcode: 'asc' },
    });
  }

  async findBinById(zoneId: string, binId: string) {
    return this.prisma.bin.findFirst({ where: { id: binId, zoneId } });
  }

  async updateBin(binId: string, dto: UpdateBinDto) {
    return this.prisma.bin.update({ where: { id: binId }, data: dto });
  }

  async deleteBin(binId: string) {
    return this.prisma.bin.delete({ where: { id: binId } });
  }
}
