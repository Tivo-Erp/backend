import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class PaymentAllocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  invoiceId: string;

  @ApiProperty({ example: 500000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  allocatedAmount: number;
}

export class CreatePaymentDto {
  @ApiProperty({
    enum: ['inbound', 'outbound'],
    description: 'inbound = receipt, outbound = disbursement',
  })
  @IsIn(['inbound', 'outbound'])
  direction: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  counterpartyId: string;

  @ApiProperty({ enum: ['customer', 'supplier'] })
  @IsIn(['customer', 'supplier'])
  counterpartyType: string;

  @ApiProperty({ example: 1000000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiProperty({ example: 'bank_transfer', maxLength: 20 })
  @IsString()
  @MaxLength(20)
  paymentMethod: string;

  @ApiProperty({ example: '2026-06-20' })
  @IsDateString()
  paymentDate: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankReference?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [PaymentAllocationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}

export class PaymentQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ enum: ['inbound', 'outbound'] })
  @IsOptional()
  @IsIn(['inbound', 'outbound'])
  direction?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  counterpartyId?: string;

  @ApiPropertyOptional({ description: 'draft, posted' })
  @IsOptional()
  @IsString()
  status?: string;
}
