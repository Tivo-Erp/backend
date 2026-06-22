import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SearchQueryDto {
  @ApiProperty({ description: 'Search text (min 2 chars)', example: 'acme' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  q: string;

  @ApiPropertyOptional({
    description:
      'Comma-separated entity types: item,customer,supplier,lead,project',
    example: 'item,customer',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): string[] | undefined =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : (value as string[] | undefined),
  )
  types?: string[];

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
