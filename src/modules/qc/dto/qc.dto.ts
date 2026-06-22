import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export const QC_SOURCE_TYPES = ['grn', 'work_order'] as const;
export const NCR_DISPOSITIONS = [
  'rework',
  'scrap',
  'return_to_supplier',
  'use_as_is',
  'pending',
] as const;
export const NCR_STATUSES = ['open', 'in_progress', 'closed'] as const;

export class CreateInspectionDto {
  @ApiProperty({ enum: QC_SOURCE_TYPES })
  @IsIn(QC_SOURCE_TYPES)
  sourceType: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 100 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  totalQty: number;
}

export class InspectionResultDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  criterionName: string;

  @ApiPropertyOptional({ example: 9.8 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  measuredValue?: number;

  @ApiProperty()
  @IsBoolean()
  passed: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SubmitResultsDto {
  @ApiProperty({ example: 95 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  acceptedQty: number;

  @ApiProperty({ example: 5 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rejectedQty: number;

  @ApiProperty({ type: [InspectionResultDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InspectionResultDto)
  results: InspectionResultDto[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  inspectorNotes?: string;
}

export class InspectionQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({
    description: 'pending, in_progress, passed, failed, partial_pass',
  })
  @IsOptional()
  @IsIn(['pending', 'in_progress', 'passed', 'failed', 'partial_pass'])
  status?: string;

  @ApiPropertyOptional({ enum: QC_SOURCE_TYPES })
  @IsOptional()
  @IsIn(QC_SOURCE_TYPES)
  sourceType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}

export class CreateNCRDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  inspectionId?: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MaxLength(5000)
  description: string;

  @ApiProperty({ enum: NCR_DISPOSITIONS })
  @IsIn(NCR_DISPOSITIONS)
  disposition: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;
}

export class UpdateNCRDto {
  @ApiPropertyOptional({ enum: NCR_DISPOSITIONS })
  @IsOptional()
  @IsIn(NCR_DISPOSITIONS)
  disposition?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignedTo?: string;

  @ApiPropertyOptional({ enum: NCR_STATUSES })
  @IsOptional()
  @IsIn(NCR_STATUSES)
  status?: string;
}

export class NCRQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ enum: NCR_STATUSES })
  @IsOptional()
  @IsIn(NCR_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  inspectionId?: string;
}
