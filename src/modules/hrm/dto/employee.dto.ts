import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class CreateEmployeeDto {
  @ApiProperty({ format: 'uuid', description: 'Linked user account' })
  @IsUUID()
  userId: string;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MaxLength(20)
  employeeCode: string;

  @ApiProperty({ description: 'Full legal name (encrypted at rest)' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  position?: string;

  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  joinDate: string;

  @ApiPropertyOptional({
    example: 15000000,
    description: 'Monthly basic salary (VND)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basicSalary?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Number of dependents for PIT',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  numberOfDependents?: number;

  @ApiPropertyOptional({ description: 'Date of birth (encrypted at rest)' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'National ID number (encrypted at rest)',
  })
  @IsOptional()
  @IsString()
  idNumber?: string;

  @ApiPropertyOptional({ description: 'Personal tax code (encrypted at rest)' })
  @IsOptional()
  @IsString()
  taxCode?: string;

  @ApiPropertyOptional({
    description: 'Social insurance number (encrypted at rest)',
  })
  @IsOptional()
  @IsString()
  socialInsNum?: string;

  @ApiPropertyOptional({
    description: 'Bank account number (encrypted at rest)',
  })
  @IsOptional()
  @IsString()
  bankAccNum?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string;
}

export class UpdateEmployeeDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  position?: string;

  @ApiPropertyOptional({
    description: 'probation, active, on_leave, terminated',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @ApiPropertyOptional({ example: 15000000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  basicSalary?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  numberOfDependents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bankAccNum?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string;
}

export class EmployeeQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({
    description: 'probation, active, on_leave, terminated',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Search by employee code' })
  @IsOptional()
  @IsString()
  search?: string;
}
