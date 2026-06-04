import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from './pagination.dto.js';

/**
 * Base DTO that adds ?fields= support to any query.
 * Extend this (or PaginatedFieldsQueryDto) in module-specific query DTOs.
 */
export class FieldsQueryDto {
  /** Comma-separated field names for Sparse Fieldsets. Example: id,name,email */
  @IsOptional()
  @IsString()
  fields?: string;
}

/**
 * Combined pagination + fields query DTO.
 * Most list endpoints should extend this.
 */
export class PaginatedFieldsQueryDto extends PaginationQueryDto {
  /** Comma-separated field names for Sparse Fieldsets. Example: id,name,status */
  @IsOptional()
  @IsString()
  fields?: string;
}
