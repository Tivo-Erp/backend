import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { ItemType } from './create-item.dto.js';

export class BulkImportItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100)
  sku: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @ApiProperty({ enum: ItemType }) @IsEnum(ItemType)
  itemType: ItemType;

  @ApiProperty() @IsString() @MaxLength(20)
  baseUom: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  weight?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isBatchTracked?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isSerialTracked?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isPurchasable?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isSellable?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  minStockLevel?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0)
  safetyStock?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0)
  leadTimeDays?: number;
}

export class BulkImportItemsDto {
  @ApiProperty({ type: [BulkImportItemDto], maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BulkImportItemDto)
  items: BulkImportItemDto[];
}

export class BulkImportResultDto {
  @ApiProperty() imported: number;
  @ApiProperty() skipped: number;
  @ApiProperty({ type: [String] }) errors: string[];
}
