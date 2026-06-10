import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto.js';

// ── INV-001: Stock Balance Query ──────────────────────────────

export class InventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ description: 'Search by SKU or item name' })
  @IsOptional() @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter items below reorder point' })
  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  belowRop?: boolean;

  @ApiPropertyOptional({ description: 'Include items with zero stock' })
  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  includeZero?: boolean;
}

// ── INV-001: Movement History Query ──────────────────────────

export enum MovementType {
  GRN_RECEIPT   = 'grn_receipt',
  SALES_SHIPMENT = 'sales_shipment',
  ADJUSTMENT    = 'adjustment',
  TRANSFER_IN   = 'transfer_in',
  TRANSFER_OUT  = 'transfer_out',
}

export class MovementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ enum: MovementType })
  @IsOptional() @IsEnum(MovementType)
  movementType?: MovementType;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional() @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional() @IsDateString()
  dateTo?: string;
}

// ── INV-002: Stock Adjustment ─────────────────────────────────

import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString as IsStr,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum AdjustmentReason {
  DAMAGED        = 'damaged',
  COUNT_VARIANCE = 'count_variance',
  EXPIRED        = 'expired',
  INITIAL_STOCK  = 'initial_stock',
  OTHER          = 'other',
}

export class AdjustmentLineDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  itemId: string;

  @ApiProperty({ description: '+positive or -negative', example: -5 })
  @IsNumber({ maxDecimalPlaces: 4 })
  adjustmentQty: number;

  @ApiProperty({ example: 'PCS' }) @IsStr()
  uom: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  binId?: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  lotId?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 4 })
  costPerUnit?: number;
}

export class CreateStockAdjustmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  warehouseId: string;

  @ApiProperty({ enum: AdjustmentReason }) @IsEnum(AdjustmentReason)
  reasonCode: AdjustmentReason;

  @ApiPropertyOptional() @IsOptional() @IsStr()
  notes?: string;

  @ApiProperty({ type: [AdjustmentLineDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines: AdjustmentLineDto[];
}

// ── INV-003: Stock Transfer ───────────────────────────────────

export class TransferLineDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  itemId: string;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 4 })
  quantity: number;

  @ApiProperty({ example: 'PCS' }) @IsStr()
  uom: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  fromBinId?: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  toBinId?: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  lotId?: string;
}

export class CreateStockTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  fromWarehouseId: string;

  @ApiProperty({ format: 'uuid' }) @IsUUID()
  toWarehouseId: string;

  @ApiPropertyOptional() @IsOptional() @IsStr()
  notes?: string;

  @ApiProperty({ type: [TransferLineDto] })
  @IsArray() @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines: TransferLineDto[];
}
