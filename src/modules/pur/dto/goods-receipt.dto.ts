import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class CreateGRNLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  poLineId: string;

  @ApiProperty({ example: 50 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  receivedQty: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  binId?: string;

  @ApiPropertyOptional({
    description: 'Lot/batch number — required for batch-tracked items',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lotNumber?: string;

  @ApiPropertyOptional({ example: '2027-01-01' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  poId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({ example: '2026-06-15' })
  @IsOptional()
  @IsDateString()
  receiptDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [CreateGRNLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateGRNLineDto)
  lines: CreateGRNLineDto[];
}

export class GoodsReceiptQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  poId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
