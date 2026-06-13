import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export const DN_STATUSES = [
  'draft',
  'picking',
  'picked',
  'packed',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned',
] as const;

export const DELIVERY_METHODS = ['self_delivery', 'carrier'] as const;
export const POD_TYPES = ['signature', 'photo', 'both', 'otp'] as const;
export const FAILURE_REASONS = [
  'customer_absent',
  'wrong_address',
  'customer_refused',
  'damaged_in_transit',
  'weather',
  'vehicle_breakdown',
  'other',
] as const;
export const RETURN_REASONS = [
  'customer_refused',
  'damaged',
  'wrong_item',
  'address_invalid',
  'other',
] as const;

// ── Create ─────────────────────────────────────────────────────

export class CreateDNLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  soLineId: string;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  binId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lotId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serialId?: string;
}

export class CreateDeliveryNoteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  soId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId: string;

  @ApiPropertyOptional({ example: '2026-06-04' })
  @IsOptional()
  @IsDateString()
  shipDate?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  shippingAddress?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryInstructions?: string;

  @ApiProperty({ type: [CreateDNLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateDNLineDto)
  lines: CreateDNLineDto[];
}

// ── Picking ────────────────────────────────────────────────────

export class PickedLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dnLineId: string;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  pickedQty: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actualBinId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actualLotId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actualSerialId?: string;
}

export class ConfirmPickedDto {
  @ApiProperty({ type: [PickedLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PickedLineDto)
  lines: PickedLineDto[];
}

// ── Packing ────────────────────────────────────────────────────

export class ConfirmPackedDto {
  @ApiProperty({ example: 12.5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  totalWeightKg: number;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalPackages?: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  packingNotes?: string;
}

// ── Dispatch ───────────────────────────────────────────────────

export class DispatchDeliveryDto {
  @ApiProperty({ enum: DELIVERY_METHODS })
  @IsIn(DELIVERY_METHODS as unknown as string[])
  deliveryMethod: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  driverName?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehiclePlate?: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  driverPhone?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  carrierId?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  serviceType?: string;
}

// ── POD ────────────────────────────────────────────────────────

export class SubmitPODDto {
  @ApiProperty({ enum: POD_TYPES })
  @IsIn(POD_TYPES as unknown as string[])
  podType: string;

  @ApiPropertyOptional({ description: 'Base64 signature image (max ~375 KB raw)' })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  signatureDataUrl?: string;

  @ApiPropertyOptional({ type: [String], description: 'Photo URLs (MinIO deferred)', maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  @MaxLength(2048, { each: true })
  photoUrls?: string[];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  receiverName?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryNotes?: string;

  @ApiPropertyOptional({ example: '2026-06-05T14:00:00Z' })
  @IsOptional()
  @IsDateString()
  deliveredAt?: string;
}

// ── Failure / Return ───────────────────────────────────────────

export class FailDeliveryDto {
  @ApiProperty({ enum: FAILURE_REASONS })
  @IsIn(FAILURE_REASONS as unknown as string[])
  failureReason: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  scheduleRetry?: boolean;

  @ApiPropertyOptional({ example: '2026-06-06' })
  @IsOptional()
  @IsDateString()
  retryDate?: string;
}

export class ReturnDeliveryDto {
  @ApiProperty({ enum: RETURN_REASONS })
  @IsIn(RETURN_REASONS as unknown as string[])
  returnReason: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  returnWarehouseId: string;
}

// ── Queries ────────────────────────────────────────────────────

export class DeliveryNoteQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ enum: DN_STATUSES })
  @IsOptional()
  @IsIn(DN_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  soId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Search by DN number' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class DeliveryScheduleQueryDto {
  @ApiProperty({ example: '2026-06-01' })
  @IsDateString()
  dateFrom: string;

  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  dateTo: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  driverName?: string;
}
