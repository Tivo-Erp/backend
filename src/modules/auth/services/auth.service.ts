import { Injectable, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { LoginDto, MfaVerifyDto, RefreshTokenDto } from '../dto/auth.dto.js';
import { JwtPayload } from '../interfaces/jwt-payload.interface.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { AuthTokenService } from './auth-token.service.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';
import { verifyTotp } from '../../../common/utils/totp.js';

// SEC: fixed bcrypt hash compared against when no user matches, so the
// not-found path costs the same as a real password check (anti-enumeration).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('timing-equalizer-dummy', 12);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authTokens: AuthTokenService,
  ) {}

  async login(dto: LoginDto, clientIp?: string) {
    const user = await this.findUserForLogin(dto.email, dto.tenantSlug);

    // SEC: anti-enumeration — when no user matches, still pay the bcrypt cost
    // so timing does not reveal account existence, then fail generically.
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      throw new BusinessException(
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // SEC: always verify the password FIRST. Account state (inactive / locked /
    // tenant suspended) is only revealed to callers holding valid credentials.
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      // SEC: atomic increment avoids the lost-update race under concurrency;
      // derive the lockout decision from the returned (post-increment) row.
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
      });
      const maxAttempts = this.configService.get<number>(
        'app.authMaxFailedAttempts',
        5,
      );
      if (updated.failedLoginCount >= maxAttempts && !updated.lockedUntil) {
        const lockMs =
          this.configService.get<number>('app.authLockDurationSec', 1800) *
          1000;
        await this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil: new Date(Date.now() + lockMs) },
        });
      }
      // SEC: same generic error whether or not the account just got locked.
      throw new BusinessException(
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Password is correct — account state may now be disclosed.
    if (user.status === 'inactive' || user.status === 'invited') {
      throw new BusinessException(
        'AUTH_ACCOUNT_INACTIVE',
        'Account is deactivated',
        HttpStatus.FORBIDDEN,
      );
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new BusinessException(
        'AUTH_ACCOUNT_LOCKED',
        `Account locked. Try again in ${minutesLeft} minutes`,
        HttpStatus.FORBIDDEN,
      );
    }

    if (user.tenant.status === 'suspended') {
      throw new BusinessException(
        'AUTH_TENANT_SUSPENDED',
        'Organization is suspended',
        HttpStatus.FORBIDDEN,
      );
    }

    // SEC-001: when MFA is enabled, do NOT issue tokens here. Return a short-lived
    // single-use challenge the client redeems via /auth/mfa/verify with a TOTP code.
    // The success bookkeeping (counter reset, lastLoginAt) is deliberately deferred
    // to loginMfaVerify: a password-only attacker must not reset the lockout state.
    if (user.mfaEnabled && user.mfaSecret) {
      const ttl = this.configService.get<number>('app.mfaChallengeTtlSec', 300);
      const challengeToken = await this.authTokens.issue(
        user.id,
        'mfa_challenge',
        ttl,
      );
      return { mfaRequired: true, challengeToken, expiresIn: ttl };
    }

    await this.recordLoginSuccess(user.id, clientIp);
    return this.issueTokens(user);
  }

  /** Reset lockout state and stamp last-login only after FULL authentication. */
  private async recordLoginSuccess(userId: string, clientIp?: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: clientIp || null,
      },
    });
  }

  /** Second login step: redeem the MFA challenge with a TOTP code → tokens. */
  async loginMfaVerify(dto: MfaVerifyDto, clientIp?: string) {
    const userId = await this.authTokens.consume(
      dto.challengeToken,
      'mfa_challenge',
    );
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (
      !user ||
      user.status !== 'active' ||
      user.tenant.status === 'suspended'
    ) {
      throw new BusinessException(
        'AUTH_ACCOUNT_INACTIVE',
        'Account or organization is not active',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new BusinessException(
        'AUTH_MFA_NOT_ENABLED',
        'MFA is not enabled for this account',
        HttpStatus.BAD_REQUEST,
      );
    }
    const secret = PiiCrypto.decrypt(user.mfaSecret);
    if (!verifyTotp(dto.code, secret)) {
      throw new BusinessException(
        'AUTH_MFA_INVALID_CODE',
        'Invalid authentication code',
        HttpStatus.UNAUTHORIZED,
      );
    }
    // Full authentication achieved only now (password + TOTP).
    await this.recordLoginSuccess(user.id, clientIp);
    return this.issueTokens(user);
  }

  /** SHA-256 hex of a refresh token; only the hash is ever persisted. */
  private hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Issue an access token + a fresh refresh token. Each refresh token belongs to
   * a rotation "family" (SEC-001): every rotation keeps the same `familyId` so a
   * replayed (already-rotated) token can be traced back and the whole family
   * revoked.
   */
  private async issueTokens(
    user: {
      id: string;
      email: string;
      tenantId: string;
      firstName: string;
      lastName: string;
      isSuperAdmin: boolean;
      tenant: { slug: string };
    },
    familyId?: string,
  ) {
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
    // SEC: 256-bit CSPRNG token; only its SHA-256 hash hits the database.
    const refreshTokenStr = randomBytes(32).toString('base64url');
    const refreshTtl = this.configService.get<number>(
      'app.jwtRefreshTtl',
      604800,
    );

    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshTokenStr),
        familyId: familyId ?? uuidv4(),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      refreshTokenId: created.id,
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
      where: { tokenHash: this.hashRefreshToken(dto.refreshToken) },
    });

    if (!storedToken) {
      throw new BusinessException(
        'AUTH_REFRESH_TOKEN_INVALID',
        'Refresh token is invalid or revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Reuse detection: a token presented after it was already rotated/revoked
    // means it leaked — revoke the entire family so the attacker's chain dies too.
    if (storedToken.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new BusinessException(
        'AUTH_REFRESH_TOKEN_REUSED',
        'Refresh token reuse detected; session revoked',
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

    if (
      !user ||
      user.status !== 'active' ||
      user.tenant.status === 'suspended'
    ) {
      throw new BusinessException(
        'AUTH_ACCOUNT_INACTIVE',
        'Account or organization is not active',
        HttpStatus.FORBIDDEN,
      );
    }

    // Rotate: claim the old token (race-safe) then mint a new one in the family.
    const claim = await this.prisma.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claim.count === 0) {
      // Lost the race to a concurrent refresh — treat as reuse.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: storedToken.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new BusinessException(
        'AUTH_REFRESH_TOKEN_REUSED',
        'Refresh token reuse detected; session revoked',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tokens = await this.issueTokens(user, storedToken.familyId);
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { replacedById: tokens.refreshTokenId },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    };
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashRefreshToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Returns the matching user or null (caller equalizes timing + fails
   * generically). NOTE: AUTH_MULTIPLE_TENANTS is still thrown before the
   * password check; it discloses only that an email maps to several tenants,
   * which is required for the client to re-prompt for a tenantSlug.
   */
  private async findUserForLogin(email: string, tenantSlug?: string) {
    if (tenantSlug) {
      return this.prisma.user.findFirst({
        where: { email, deletedAt: null, tenant: { slug: tenantSlug } },
        include: { tenant: true },
      });
    }

    const users = await this.prisma.user.findMany({
      where: { email, deletedAt: null },
      include: { tenant: true },
    });

    if (users.length === 0) {
      return null;
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

  /**
   * Pre-login tenant discovery. Returns the tenants whose membership matches the
   * given credentials so a multi-tenant client can prompt for a tenant before
   * calling /login. SEC: the password is verified against every candidate row,
   * so this never reveals which tenants an email exists in WITHOUT the password
   * (consistent with the anti-enumeration posture of login). When nothing
   * matches, the bcrypt cost is still paid once and an empty list is returned.
   */
  async getTenantsForCredentials(email: string, password: string) {
    const users = await this.prisma.user.findMany({
      where: { email, deletedAt: null },
      include: { tenant: true },
    });

    if (users.length === 0) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return { tenants: [] };
    }

    const matched: typeof users = [];
    for (const user of users) {
      if (await bcrypt.compare(password, user.passwordHash)) {
        matched.push(user);
      }
    }

    return {
      tenants: matched.map((u) => ({
        tenantId: u.tenantId,
        tenantSlug: u.tenant.slug,
        tenantName: u.tenant.name,
        logoUrl: u.tenant.logoUrl ?? null,
      })),
    };
  }

  /** Current authenticated user's profile (fresh from DB) + roles/permissions. */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user || user.deletedAt) {
      throw new BusinessException(
        'AUTH_ACCOUNT_INACTIVE',
        'Account not found',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const { roles, permissions } = await this.loadRolesAndPermissions(user.id);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl ?? null,
      status: user.status,
      isSuperAdmin: user.isSuperAdmin,
      mfaEnabled: user.mfaEnabled,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null,
      tenantId: user.tenantId,
      tenantSlug: user.tenant.slug,
      tenantName: user.tenant.name,
      roles,
      permissions,
    };
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
