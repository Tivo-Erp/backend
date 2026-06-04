import { Injectable, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { LoginDto, RefreshTokenDto } from '../dto/auth.dto.js';
import { JwtPayload } from '../interfaces/jwt-payload.interface.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto, clientIp?: string) {
    const user = await this.findUserForLogin(dto.email, dto.tenantSlug);

    if (user.status === 'inactive' || user.status === 'invited') {
      throw new BusinessException(
        'AUTH_ACCOUNT_INACTIVE',
        'Account is deactivated',
        HttpStatus.FORBIDDEN,
      );
    }

    if (user.lockedUntil) {
      if (user.lockedUntil > new Date()) {
        const minutesLeft = Math.ceil(
          (user.lockedUntil.getTime() - Date.now()) / 60000,
        );
        throw new BusinessException(
          'AUTH_ACCOUNT_LOCKED',
          `Account locked. Try again in ${minutesLeft} minutes`,
          HttpStatus.FORBIDDEN,
        );
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    if (user.tenant.status === 'suspended') {
      throw new BusinessException(
        'AUTH_TENANT_SUSPENDED',
        'Organization is suspended',
        HttpStatus.FORBIDDEN,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      const newFailedCount = user.failedLoginCount + 1;
      const updateData: any = { failedLoginCount: newFailedCount };

      if (newFailedCount >= MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        await this.prisma.user.update({
          where: { id: user.id },
          data: updateData,
        });
        throw new BusinessException(
          'AUTH_ACCOUNT_LOCKED',
          'Account locked due to too many failed attempts. Try again in 30 minutes',
          HttpStatus.FORBIDDEN,
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
      throw new BusinessException(
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: clientIp || null,
      },
    });

    const { roles, permissions } = await this.loadRolesAndPermissions(user.id);

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      roles,
      permissions,
      isSuperAdmin: user.isSuperAdmin,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshTokenStr = uuidv4();
    const refreshTtl = this.configService.get<number>('app.jwtRefreshTtl', 604800);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshTokenStr,
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      expiresIn: this.configService.get<number>('app.jwtAccessTtl', 3600),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: dto.refreshToken },
    });

    if (!storedToken || storedToken.revokedAt) {
      throw new BusinessException(
        'AUTH_REFRESH_TOKEN_INVALID',
        'Refresh token is invalid or revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (storedToken.expiresAt < new Date()) {
      throw new BusinessException(
        'AUTH_REFRESH_TOKEN_EXPIRED',
        'Refresh token has expired',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: storedToken.userId },
      include: { tenant: true },
    });

    if (!user || user.status !== 'active' || user.tenant.status === 'suspended') {
      throw new BusinessException(
        'AUTH_ACCOUNT_INACTIVE',
        'Account or organization is not active',
        HttpStatus.FORBIDDEN,
      );
    }

    const { roles, permissions } = await this.loadRolesAndPermissions(user.id);

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      roles,
      permissions,
      isSuperAdmin: user.isSuperAdmin,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      expiresIn: this.configService.get<number>('app.jwtAccessTtl', 3600),
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token: refreshToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async findUserForLogin(email: string, tenantSlug?: string) {
    if (tenantSlug) {
      const user = await this.prisma.user.findFirst({
        where: { email, tenant: { slug: tenantSlug } },
        include: { tenant: true },
      });
      if (!user) {
        throw new BusinessException(
          'AUTH_INVALID_CREDENTIALS',
          'Invalid email or password',
          HttpStatus.UNAUTHORIZED,
        );
      }
      return user;
    }

    const users = await this.prisma.user.findMany({
      where: { email },
      include: { tenant: true },
    });

    if (users.length === 0) {
      throw new BusinessException(
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (users.length > 1) {
      throw new BusinessException(
        'AUTH_MULTIPLE_TENANTS',
        'User belongs to multiple tenants, specify tenantSlug',
        HttpStatus.CONFLICT,
      );
    }

    return users[0];
  }

  private async loadRolesAndPermissions(userId: string) {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissionSet = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        permissionSet.add(rp.permission.code);
      }
    }

    return { roles, permissions: Array.from(permissionSet) };
  }
}
