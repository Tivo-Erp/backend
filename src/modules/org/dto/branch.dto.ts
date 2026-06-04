import {
  IsString,
  IsOptional,
  IsEmail,
  IsBoolean,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  isHeadquarters?: boolean;
}

export class UpdateBranchDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  isHeadquarters?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
