import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export enum JournalSourceType {
  MANUAL = 'manual',
  SALES = 'sales',
  PURCHASE = 'purchase',
  PAYROLL = 'payroll',
  DEPRECIATION = 'depreciation',
  ADJUSTMENT = 'adjustment',
}

export class JournalEntryLineDto {
  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  accountCode: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    example: 1000000,
    description: 'Debit amount (0 if this is a credit line)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debitAmount: number;

  @ApiProperty({
    example: 0,
    description: 'Credit amount (0 if this is a debit line)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditAmount: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  costCenterId?: string;
}

export class CreateJournalBatchDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '2026-06-15' })
  @IsDateString()
  journalDate: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @ApiProperty({ enum: JournalSourceType })
  @IsEnum(JournalSourceType)
  sourceType: JournalSourceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiProperty({ type: [JournalEntryLineDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  entries: JournalEntryLineDto[];
}

export class UpdateJournalBatchDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: '2026-06-15' })
  @IsOptional()
  @IsDateString()
  journalDate?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reference?: string;

  @ApiPropertyOptional({ enum: JournalSourceType })
  @IsOptional()
  @IsEnum(JournalSourceType)
  sourceType?: JournalSourceType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional({
    type: [JournalEntryLineDto],
    minItems: 2,
    description: 'Replaces ALL existing entries when provided',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalEntryLineDto)
  entries?: JournalEntryLineDto[];
}

export class JournalBatchQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ description: 'draft, posted, reversed' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: JournalSourceType })
  @IsOptional()
  @IsEnum(JournalSourceType)
  sourceType?: JournalSourceType;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
