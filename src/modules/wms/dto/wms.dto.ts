import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ── Warehouse ─────────────────────────────────────────────────

export class CreateWarehouseDto {
  @ApiProperty({ example: 'WH-HN' })
  @IsString() @MinLength(1) @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'Hà Nội Main Warehouse' })
  @IsString() @MinLength(1) @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '123 Giải Phóng, Hà Nội' })
  @IsOptional() @IsString()
  address?: string;
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  address?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;
}

// ── Zone ──────────────────────────────────────────────────────

export enum ZoneType {
  BULK       = 'bulk',
  PICK       = 'pick',
  STAGING    = 'staging',
  QUARANTINE = 'quarantine',
  DISPATCH   = 'dispatch',
  RECEIVING  = 'receiving',
  STORAGE    = 'storage',
}

export class CreateZoneDto {
  @ApiProperty({ example: 'ZONE-A' })
  @IsString() @MaxLength(20)
  code: string;

  @ApiProperty({ example: 'Zone A — Picking' })
  @IsString() @MaxLength(200)
  name: string;

  @ApiProperty({ enum: ZoneType })
  @IsEnum(ZoneType)
  zoneType: ZoneType;
}

export class UpdateZoneDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: ZoneType }) @IsOptional() @IsEnum(ZoneType)
  zoneType?: ZoneType;
}

// ── Bin ───────────────────────────────────────────────────────

export enum BinType {
  GENERAL     = 'general',
  PICK        = 'pick',
  BULK        = 'bulk',
  PALLET      = 'pallet',
  REFRIGERATED = 'refrigerated',
}

export class CreateBinDto {
  @ApiProperty({ example: 'A-01-001' })
  @IsString() @MaxLength(50)
  barcode: string;

  @ApiPropertyOptional({ example: 'Shelf A Row 1 Slot 1' })
  @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @ApiProperty({ enum: BinType })
  @IsEnum(BinType)
  binType: BinType;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  maxWeightKg?: number;
}

export class UpdateBinDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ enum: BinType }) @IsOptional() @IsEnum(BinType)
  binType?: BinType;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  maxWeightKg?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isActive?: boolean;
}
