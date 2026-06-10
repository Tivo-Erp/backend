import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/infra/database/prisma.service.js';
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
  constructor(private readonly prisma: PrismaService) {}

  // ── Warehouse ────────────────────────────────────────────────

  async createWarehouse(tenantId: string, dto: CreateWarehouseDto) {
    const exists = await this.prisma.warehouse.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (exists) throw new ConflictException('WMS_WAREHOUSE_CODE_DUPLICATE');

    return this.prisma.warehouse.create({ data: { tenantId, ...dto } });
  }

  async findAllWarehouses(tenantId: string) {
    return this.prisma.warehouse.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, branchId: true, isActive: true, createdAt: true },
      orderBy: { code: 'asc' },
    });
  }

  async findWarehouseById(tenantId: string, id: string) {
    const wh = await this.prisma.warehouse.findFirst({
      where: { id, tenantId },
      include: { zones: { include: { bins: true } } },
    });
    if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');
    return wh;
  }

  async updateWarehouse(tenantId: string, id: string, dto: UpdateWarehouseDto) {
    const wh = await this.prisma.warehouse.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');
    return this.prisma.warehouse.update({ where: { id }, data: dto });
  }

  async deleteWarehouse(tenantId: string, id: string) {
    const wh = await this.prisma.warehouse.findFirst({ where: { id, tenantId } });
    if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');

    // Guard: cannot delete if it has inventory
    const hasStock = await this.prisma.inventoryBalance.findFirst({
      where: { warehouseId: id, quantityOnHand: { gt: 0 } },
    });
    if (hasStock) throw new ConflictException('WMS_WAREHOUSE_HAS_STOCK');

    await this.prisma.warehouse.delete({ where: { id } });
  }

  // ── Zone ─────────────────────────────────────────────────────

  async createZone(tenantId: string, warehouseId: string, dto: CreateZoneDto) {
    await this.assertWarehouseOwnership(tenantId, warehouseId);

    const exists = await this.prisma.zone.findFirst({
      where: { warehouseId, code: dto.code },
    });
    if (exists) throw new ConflictException('WMS_ZONE_CODE_DUPLICATE');

    return this.prisma.zone.create({ data: { warehouseId, ...dto } });
  }

  async findZones(tenantId: string, warehouseId: string) {
    await this.assertWarehouseOwnership(tenantId, warehouseId);
    return this.prisma.zone.findMany({
      where: { warehouseId },
      select: { id: true, code: true, name: true, zoneType: true },
      orderBy: { code: 'asc' },
    });
  }

  async updateZone(tenantId: string, warehouseId: string, zoneId: string, dto: UpdateZoneDto) {
    await this.assertZoneOwnership(tenantId, warehouseId, zoneId);
    return this.prisma.zone.update({ where: { id: zoneId }, data: dto });
  }

  async deleteZone(tenantId: string, warehouseId: string, zoneId: string) {
    await this.assertZoneOwnership(tenantId, warehouseId, zoneId);
    await this.prisma.zone.delete({ where: { id: zoneId } });
  }

  // ── Bin ──────────────────────────────────────────────────────

  async createBin(tenantId: string, warehouseId: string, zoneId: string, dto: CreateBinDto) {
    await this.assertZoneOwnership(tenantId, warehouseId, zoneId);

    const exists = await this.prisma.bin.findFirst({
      where: { zoneId, barcode: dto.barcode },
    });
    if (exists) throw new ConflictException('WMS_BIN_BARCODE_DUPLICATE');

    return this.prisma.bin.create({ data: { zoneId, ...dto } });
  }

  async findBins(tenantId: string, warehouseId: string, zoneId: string) {
    await this.assertZoneOwnership(tenantId, warehouseId, zoneId);
    return this.prisma.bin.findMany({
      where: { zoneId, isActive: true },
      select: { id: true, barcode: true, label: true, binType: true, maxWeightKg: true },
      orderBy: { barcode: 'asc' },
    });
  }

  async updateBin(tenantId: string, warehouseId: string, zoneId: string, binId: string, dto: UpdateBinDto) {
    await this.assertZoneOwnership(tenantId, warehouseId, zoneId);
    const bin = await this.prisma.bin.findFirst({ where: { id: binId, zoneId } });
    if (!bin) throw new NotFoundException('WMS_BIN_NOT_FOUND');
    return this.prisma.bin.update({ where: { id: binId }, data: dto });
  }

  async deleteBin(tenantId: string, warehouseId: string, zoneId: string, binId: string) {
    await this.assertZoneOwnership(tenantId, warehouseId, zoneId);
    const bin = await this.prisma.bin.findFirst({ where: { id: binId, zoneId } });
    if (!bin) throw new NotFoundException('WMS_BIN_NOT_FOUND');
    await this.prisma.bin.delete({ where: { id: binId } });
  }

  // ── Private helpers ──────────────────────────────────────────

  private async assertWarehouseOwnership(tenantId: string, warehouseId: string) {
    const wh = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId } });
    if (!wh) throw new NotFoundException('WMS_WAREHOUSE_NOT_FOUND');
    return wh;
  }

  private async assertZoneOwnership(tenantId: string, warehouseId: string, zoneId: string) {
    await this.assertWarehouseOwnership(tenantId, warehouseId);
    const zone = await this.prisma.zone.findFirst({ where: { id: zoneId, warehouseId } });
    if (!zone) throw new NotFoundException('WMS_ZONE_NOT_FOUND');
    return zone;
  }
}
