import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class InitFiscalPeriodsDto {
  @ApiProperty({
    example: 2026,
    description: 'Initialize 12 monthly periods for this year',
  })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;
}

export class FiscalPeriodQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ example: 2026 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
