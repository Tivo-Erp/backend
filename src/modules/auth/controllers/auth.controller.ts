import { Controller, Post, Get, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from '../services/auth.service.js';
import { AccountSecurityService } from '../services/account-security.service.js';
import {
  LoginDto,
  LoginResponseDto,
  RefreshTokenDto,
  MfaVerifyDto,
  MfaCodeDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  TokenConfirmDto,
  TenantDiscoveryDto,
  TenantDiscoveryResponseDto,
  MeResponseDto,
} from '../dto/auth.dto.js';
import { Public, CurrentUser } from '../../../common/decorators/index.js';
import type { JwtPayload } from '../interfaces/jwt-payload.interface.js';
import type { FastifyRequest } from 'fastify';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountSecurity: AccountSecurityService,
  ) {}

  @Post('tenants')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'List tenants for credentials',
    description:
      'Pre-login discovery. Given email + password, returns the tenants the ' +
      'user can sign into so a multi-tenant client can prompt for a tenant ' +
      'before calling /login with `tenantSlug`. Returns an empty list when no ' +
      'tenant matches the credentials (no account enumeration).',
  })
  @ApiBody({ type: TenantDiscoveryDto })
  @ApiResponse({
    status: 200,
    description: 'Matching tenants (possibly empty)',
    type: TenantDiscoveryResponseDto,
  })
  async tenants(@Body() dto: TenantDiscoveryDto) {
    return this.authService.getTenantsForCredentials(dto.email, dto.password);
  }

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticate with email/password. Returns JWT tokens, or `mfaRequired` + challenge when MFA is enabled.',
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: LoginResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({
    status: 403,
    description: 'Account locked / inactive / tenant suspended',
  })
  @ApiResponse({
    status: 409,
    description: 'Multiple tenants — specify tenantSlug',
  })
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest) {
    return this.authService.login(dto, req.ip);
  }

  @Post('mfa/verify')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'MFA login step',
    description:
      'Redeem the challenge token from /login with a 6-digit TOTP code to receive JWT tokens.',
  })
  @ApiBody({ type: MfaVerifyDto })
  async mfaVerify(@Body() dto: MfaVerifyDto, @Req() req: FastifyRequest) {
    return this.authService.loginMfaVerify(dto, req.ip);
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Refresh Token',
    description:
      'Rotate the refresh token (old one revoked) and get a new access token. Reuse of a rotated token revokes the whole session family.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({
    status: 200,
    description: 'New access + refresh token issued',
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token invalid, expired, or reused',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @Public()
  @ApiOperation({ summary: 'Logout', description: 'Revoke refresh token.' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  // ── Current user ─────────────────────────────────────────────────

  @Get('me')
  @ApiBearerAuth('JWT-Auth')
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Return the authenticated user profile (resolved from the bearer token), ' +
      'including tenant context, roles and permissions.',
  })
  @ApiResponse({ status: 200, description: 'Current user', type: MeResponseDto })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }

  // ── MFA management (authenticated self-service) ──────────────────

  @Post('mfa/setup')
  @ApiBearerAuth('JWT-Auth')
  @ApiOperation({
    summary: 'Begin MFA setup',
    description:
      'Generate a TOTP secret + otpauth URL for the current user. Confirm with /mfa/enable.',
  })
  async mfaSetup(@CurrentUser() user: JwtPayload) {
    return this.accountSecurity.mfaSetup(user.sub);
  }

  @Post('mfa/enable')
  @ApiBearerAuth('JWT-Auth')
  @ApiOperation({
    summary: 'Enable MFA',
    description: 'Confirm setup with a 6-digit code to turn MFA on.',
  })
  @ApiBody({ type: MfaCodeDto })
  async mfaEnable(@CurrentUser() user: JwtPayload, @Body() dto: MfaCodeDto) {
    return this.accountSecurity.mfaEnable(user.sub, dto.code);
  }

  @Post('mfa/disable')
  @ApiBearerAuth('JWT-Auth')
  @ApiOperation({ summary: 'Disable MFA' })
  @ApiBody({ type: MfaCodeDto })
  async mfaDisable(@CurrentUser() user: JwtPayload, @Body() dto: MfaCodeDto) {
    return this.accountSecurity.mfaDisable(user.sub, dto.code);
  }

  // ── Password reset (public) ──────────────────────────────────────

  @Post('password/forgot')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Sends a reset link if the account exists (always returns success).',
  })
  @ApiBody({ type: ForgotPasswordDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.accountSecurity.forgotPassword(dto.email, dto.tenantSlug);
  }

  @Post('password/reset')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Reset password',
    description:
      'Set a new password using a reset token; revokes all sessions.',
  })
  @ApiBody({ type: ResetPasswordDto })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.accountSecurity.resetPassword(dto.token, dto.newPassword);
  }

  // ── Email verification ───────────────────────────────────────────

  @Post('email/verify/request')
  @ApiBearerAuth('JWT-Auth')
  @ApiOperation({ summary: 'Request email verification link' })
  async requestEmailVerify(@CurrentUser() user: JwtPayload) {
    return this.accountSecurity.requestEmailVerification(user.sub);
  }

  @Post('email/verify/confirm')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Confirm email verification' })
  @ApiBody({ type: TokenConfirmDto })
  async confirmEmailVerify(@Body() dto: TokenConfirmDto) {
    return this.accountSecurity.confirmEmailVerification(dto.token);
  }
}
