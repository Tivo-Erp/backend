import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

export class LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    tenantSlug: string;
  };
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}
