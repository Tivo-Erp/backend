import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginatedFieldsQueryDto } from '../../../common/dto/fields-query.dto.js';

export class CreateInvoiceDto {
  @ApiProperty({
    enum: ['sales', 'purchase'],
    description: 'sales = AR, purchase = AP',
  })
  @IsIn(['sales', 'purchase'])
  invoiceType: string;

  @ApiProperty({
    format: 'uuid',
    description: 'customerId (sales) or supplierId (purchase)',
  })
  @IsUUID()
  partyId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Source SO or PO id' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional({ example: '2026-06-15' })
  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @ApiPropertyOptional({ example: '2026-07-15' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiProperty({ example: 1000000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  subTotal: number;

  @ApiPropertyOptional({ example: 100000, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount?: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class InvoiceQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ enum: ['sales', 'purchase'] })
  @IsOptional()
  @IsIn(['sales', 'purchase'])
  invoiceType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  partyId?: string;

  @ApiPropertyOptional({ description: 'open, partially_paid, paid, cancelled' })
  @IsOptional()
  @IsString()
  status?: string;
}
