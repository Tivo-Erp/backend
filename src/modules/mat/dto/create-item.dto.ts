import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum ItemType {
  PRODUCT        = 'product',
  RAW_MATERIAL   = 'raw_material',
  SEMI_FINISHED  = 'semi_finished',
  SERVICE        = 'service',
  CONSUMABLE     = 'consumable',
}

export class CreateItemDto {
  @ApiProperty({ example: 'SKU-001' })
  @IsString() @MinLength(1) @MaxLength(100)
  sku: string;

  @ApiProperty({ example: 'Widget A' })
  @IsString() @MinLength(1) @MaxLength(500)
  name: string;

  @ApiPropertyOptional({ example: 'A small widget for assembly' })
  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiProperty({ enum: ItemType })
  @IsEnum(ItemType)
  itemType: ItemType;

  @ApiProperty({ example: 'PCS' })
  @IsString() @MaxLength(20)
  baseUom: string;

  @ApiPropertyOptional({ example: 0.5 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  weight?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  isBatchTracked?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @IsBoolean()
  isSerialTracked?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isPurchasable?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isSellable?: boolean;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  minStockLevel?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  safetyStock?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional() @IsInt() @Min(0)
  leadTimeDays?: number;
}
