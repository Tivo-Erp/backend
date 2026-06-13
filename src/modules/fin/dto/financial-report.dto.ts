import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, Matches } from 'class-validator';

/** A single fiscal month, e.g. `2026-06`. */
export class PeriodQueryDto {
  @ApiProperty({ example: '2026-06', description: 'Fiscal period YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period: string;
}

/** A from/to range of fiscal months (inclusive). */
export class DateRangeQueryDto {
  @ApiProperty({ example: '2026-01', description: 'From fiscal period YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'from must be YYYY-MM' })
  from: string;

  @ApiProperty({ example: '2026-06', description: 'To fiscal period YYYY-MM (inclusive)' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'to must be YYYY-MM' })
  to: string;
}

/** Balance sheet — cumulative as of a date (spec param: `date`). */
export class BalanceSheetQueryDto {
  @ApiPropertyOptional({ example: '2026-06-30', description: 'As-of date YYYY-MM-DD (default: today)' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

/** AP/AR aging — as of a date (default today); buckets 30/60/90/120+. */
export class AgingQueryDto {
  @ApiPropertyOptional({ example: '2026-06-30', description: 'As-of date YYYY-MM-DD (default: today)' })
  @IsOptional()
  @IsDateString()
  asOfDate?: string;
}
