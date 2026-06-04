import {
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

export class RegisterTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MinLength(3)
  @MaxLength(63)
  slug: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/(?=.*[A-Z])(?=.*[0-9])/, {
    message: 'Password must contain at least 1 uppercase letter and 1 number',
  })
  password: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  taxCode?: string;

  @IsString()
  @IsOptional()
  timezone?: string;
}
