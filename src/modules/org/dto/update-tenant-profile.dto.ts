import { IsString, IsOptional, MaxLength, IsObject } from 'class-validator';

export class UpdateTenantProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  legalName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  taxCode?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  timezone?: string;

  @IsObject()
  @IsOptional()
  settings?: Record<string, unknown>;
}
