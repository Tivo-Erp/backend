import {
  IsEmail,
  IsString,
  IsOptional,
  IsArray,
  IsUUID,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  roleIds: string[];

  @IsUUID()
  @IsOptional()
  branchId?: string;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsArray()
  @IsOptional()
  @IsUUID('4', { each: true })
  roleIds?: string[];
}
