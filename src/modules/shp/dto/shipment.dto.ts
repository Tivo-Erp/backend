import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';
import { SHIPMENT_STATUSES } from '../shipment-status.util.js';

export class CreateShipmentDto {
  @ApiProperty({ format: 'uuid', description: 'Delivery note to ship' })
  @IsUUID()
  dnId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  carrierId: string;

  @ApiPropertyOptional({ example: 'standard', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  serviceType?: string;

  @ApiPropertyOptional({ example: 2.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lengthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  widthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  heightCm?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCod?: boolean;

  @ApiPropertyOptional({
    description: 'Cash-on-delivery amount (required if isCod)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  codAmount?: number;

  @ApiPropertyOptional({
    description: 'Destination region for rate/label hints',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  toRegion?: string;
}

export class ManualTrackingDto {
  @ApiProperty({ description: 'Tracking number supplied by the carrier' })
  @IsString()
  @MaxLength(100)
  trackingNumber: string;
}

export class ShipmentQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ enum: SHIPMENT_STATUSES })
  @IsOptional()
  @IsIn(SHIPMENT_STATUSES)
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  carrierId?: string;

  @ApiPropertyOptional({ description: 'Search by shipment/tracking number' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class RateCompareDto {
  @ApiProperty({ example: 2.5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  weightKg: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lengthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  widthCm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  heightCm?: number;

  @ApiPropertyOptional({ example: 'express' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  serviceType?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isCod?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  codAmount?: number;

  @ApiPropertyOptional({ description: 'Destination region' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  toRegion?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Restrict the comparison to these carrier ids (default: all active carriers)',
  })
  @IsOptional()
  @IsUUID('all', { each: true })
  carrierIds?: string[];
}

/**
 * Public tracking webhook payload. Loosely typed on purpose — each carrier
 * posts a different shape; the service normalizes `status` and timestamps.
 */
export class TrackingWebhookDto {
  @ApiProperty({ description: 'Carrier tracking number' })
  @IsString()
  @MaxLength(100)
  trackingNumber: string;

  @ApiProperty({ description: 'Raw carrier status (normalized server-side)' })
  @IsString()
  @MaxLength(50)
  status: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({ description: 'ISO event time (defaults to now)' })
  @IsOptional()
  @IsString()
  eventTime?: string;
}

export class PublicTrackQueryDto {
  @ApiProperty({ description: 'Opaque tracking token from the shipment link' })
  @IsString()
  @MaxLength(64)
  token: string;
}
