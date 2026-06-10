import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginatedFieldsQueryDto } from 'src/common/dto/fields-query.dto.js';
import { ItemStatus } from './update-item.dto.js';
import { ItemType } from './create-item.dto.js';

export class ItemQueryDto extends PaginatedFieldsQueryDto {
  @ApiPropertyOptional({ enum: ItemStatus })
  @IsOptional() @IsEnum(ItemStatus)
  status?: ItemStatus;

  @ApiPropertyOptional({ enum: ItemType })
  @IsOptional() @IsEnum(ItemType)
  itemType?: ItemType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Search by SKU or name' })
  @IsOptional() @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isPurchasable?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  isSellable?: boolean;
}
