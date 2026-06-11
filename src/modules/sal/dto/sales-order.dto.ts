import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class CreateSOLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity: number;

  @ApiProperty({ example: 'PCS', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  uom: string;

  @ApiProperty({ example: 50000 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 100 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPct?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  taxRateId?: string;

  // TODO(tax-master): taxRate is client-supplied only because no TaxRate
  // master model exists yet. Once a TaxRate model lands, this field must be
  // derived server-side from taxRateId and removed from the public contract.
  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    maximum: 100,
    description:
      'Tax rate percentage (VAT), 0–100, max 2 decimal places. Temporary client-supplied value until a TaxRate master exists.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;
}

export class CreateSalesOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ example: '2026-07-01' })
  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [CreateSOLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSOLineDto)
  lines: CreateSOLineDto[];
}

export class SalesOrderQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({
    description: 'draft, pending_approval, approved, cancelled',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Search by SO number' })
  @IsOptional()
  @IsString()
  search?: string;
}
