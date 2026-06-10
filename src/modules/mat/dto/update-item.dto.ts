import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateItemDto } from './create-item.dto.js';

export enum ItemStatus {
  DRAFT         = 'draft',
  ACTIVE        = 'active',
  DISCONTINUED  = 'discontinued',
  ARCHIVED      = 'archived',
}

export class UpdateItemDto extends PartialType(CreateItemDto) {
  @ApiPropertyOptional({ enum: ItemStatus })
  @IsOptional() @IsEnum(ItemStatus)
  status?: ItemStatus;
}
