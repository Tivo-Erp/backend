import {
  IsEmail,
  IsString,
  IsOptional,
  MinLength,
  Matches,
} from 'class-validator';

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

// ── Tenant discovery (pre-login) ──────────────────────────────────

export class TenantDiscoveryDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class TenantSummaryDto {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  logoUrl: string | null;
}

export class TenantDiscoveryResponseDto {
  tenants: TenantSummaryDto[];
}

// ── Current user profile (GET /auth/me) ───────────────────────────

export class MeResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: string;
  isSuperAdmin: boolean;
  mfaEnabled: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  roles: string[];
  permissions: string[];
}

// ── SEC-001: Auth hardening DTOs ──────────────────────────────────

export class MfaVerifyDto {
  @IsString()
  challengeToken: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}

export class MfaCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class TokenConfirmDto {
  @IsString()
  token: string;
}
