import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export const DEPRECIATION_METHODS = ['straight_line', 'declining_balance'] as const;

export class CreateFixedAssetDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  assetCode: string;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  name: string;

  @ApiProperty({ example: '2111', description: 'Asset GL account: 2111, 2112, 2113, 2114' })
  @IsString()
  @MaxLength(20)
  accountCode: string;

  @ApiProperty({ example: 120000000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  acquisitionCost: number;

  @ApiProperty({ example: 12000000, description: 'Salvage/residual value' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  residualValue: number;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  acquisitionDate: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  inServiceDate?: string;

  @ApiProperty({ enum: DEPRECIATION_METHODS })
  @IsIn(DEPRECIATION_METHODS as unknown as string[])
  depreciationMethod: string;

  @ApiProperty({ example: 60, minimum: 1, maximum: 480 })
  @IsInt()
  @Min(1)
  @Max(480)
  usefulLifeMonths: number;

  @ApiPropertyOptional({ example: '642', description: 'Depreciation expense account (627/641/642)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  expenseAccountCode?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateFixedAssetDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ActivateAssetDto {
  @ApiPropertyOptional({ example: '2026-01-15', description: 'In-service date (default: today)' })
  @IsOptional()
  @IsDateString()
  inServiceDate?: string;
}

export class DisposeAssetDto {
  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  disposalDate: string;

  @ApiPropertyOptional({ example: 5000000, description: 'Sale proceeds (0 = scrap)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  disposalProceeds?: number;
}

export class TransferAssetDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class RunDepreciationDto {
  @ApiProperty({ example: 6, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: 2026 })
  @IsInt()
  @Min(2000)
  year: number;
}

export class FixedAssetQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ description: 'draft, in_use, disposed, transferred' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Search by asset code or name' })
  @IsOptional()
  @IsString()
  search?: string;
}
