import { IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class AuditLogQueryDto extends PaginatedFieldsQueryDto {
  /** Filter by module: ORG, UAM, etc. */
  @IsOptional()
  @IsString()
  module?: string;

  /** Filter by action: CREATE, UPDATE, DELETE */
  @IsOptional()
  @IsString()
  action?: string;

  /** Filter by user who performed the action */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Filter by start date (ISO 8601) */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Filter by end date (ISO 8601) */
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
