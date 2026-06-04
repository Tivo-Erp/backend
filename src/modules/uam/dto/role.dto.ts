import {
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  MinLength,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  permissionIds: string[];
}

export class UpdateRoleDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  permissionIds?: string[];
}
