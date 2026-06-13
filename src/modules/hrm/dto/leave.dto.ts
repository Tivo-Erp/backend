import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export const HALF_DAY_VALUES = ['full_day', 'morning', 'afternoon'] as const;

export class CreateLeaveTypeDto {
  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ default: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresDoc?: boolean;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxCarryOver?: number;
}

export class CreateLeaveRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  employeeId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ example: '2026-07-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-07-03' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ enum: HALF_DAY_VALUES, default: 'full_day' })
  @IsOptional()
  @IsIn(HALF_DAY_VALUES as unknown as string[])
  halfDay?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class LeaveActionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class LeaveRequestQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'pending, approved, rejected, cancelled' })
  @IsOptional()
  @IsString()
  status?: string;
}
