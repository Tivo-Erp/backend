import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CUBE_NAMES } from '../cube-registry.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class OlapQueryDto {
  @ApiProperty({ enum: CUBE_NAMES, example: 'fact_sales' })
  @IsIn(CUBE_NAMES)
  cube: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Row dimensions (group-by). Max 5 dimensions total (rows+columns).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  rows?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Column (pivot) dimensions',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  columns?: string[];

  @ApiProperty({ type: [String], example: ['net', 'orders'] })
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  measures: string[];

  @ApiPropertyOptional({
    description: 'Equality filters keyed by dimension name',
    example: { status: 'fulfilled' },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, string>;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;

  @ApiPropertyOptional({ default: 1000, minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;
}
