import { Controller, Post, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { AuthService } from '../services/auth.service.js';
import { LoginDto, LoginResponseDto, RefreshTokenDto } from '../dto/auth.dto.js';
import { Public } from '../../../common/decorators/index.js';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'Login', description: 'Authenticate user with email/password. Returns JWT access + refresh tokens.' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account locked / inactive / tenant suspended' })
  @ApiResponse({ status: 409, description: 'Multiple tenants — specify tenantSlug' })
  async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto, req.ip);
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Refresh Token', description: 'Exchange valid refresh token for new access token.' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 200, description: 'New access token issued' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired' })
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
}

