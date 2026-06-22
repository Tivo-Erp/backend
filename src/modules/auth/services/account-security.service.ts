import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { EmailService } from '../../../infra/email/email.service.js';
import { PiiCrypto } from '../../../common/utils/pii-crypto.js';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotp,
} from '../../../common/utils/totp.js';
import { AuthTokenService } from './auth-token.service.js';

/**
 * SEC-001 self-service account security: TOTP MFA lifecycle, password reset and
 * email verification. MFA secrets are stored encrypted (reuses {@link PiiCrypto}
 * envelope, ADR-007) and never returned again after setup.
 */
@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authTokens: AuthTokenService,
    private readonly email: EmailService,
  ) {}

  // ── MFA ──────────────────────────────────────────────────────────
  /** Generate + store (encrypted) a pending secret and return its provisioning URI. */
  async mfaSetup(userId: string) {
    const user = await this.requireUser(userId);
    if (user.mfaEnabled) {
      throw new BusinessException(
        'AUTH_MFA_ALREADY_ENABLED',
        'MFA is already enabled',
        HttpStatus.CONFLICT,
      );
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: PiiCrypto.encrypt(secret) },
    });
    const issuer = this.config.get<string>('app.mfaIssuer', 'ERP');
    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(issuer, user.email, secret),
    };
  }

  /** Verify the first code against the pending secret and turn MFA on. */
  async mfaEnable(userId: string, code: string) {
    const user = await this.requireUser(userId);
    if (!user.mfaSecret) {
      throw new BusinessException(
        'AUTH_MFA_NOT_SETUP',
        'Run MFA setup before enabling',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!verifyTotp(code, PiiCrypto.decrypt(user.mfaSecret))) {
      throw new BusinessException(
        'AUTH_MFA_INVALID_CODE',
        'Invalid authentication code',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
    return { mfaEnabled: true };
  }

  /** Disable MFA after confirming a current code. */
  async mfaDisable(userId: string, code: string) {
    const user = await this.requireUser(userId);
    if (!user.mfaEnabled || !user.mfaSecret) {
      throw new BusinessException(
        'AUTH_MFA_NOT_ENABLED',
        'MFA is not enabled',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!verifyTotp(code, PiiCrypto.decrypt(user.mfaSecret))) {
      throw new BusinessException(
        'AUTH_MFA_INVALID_CODE',
        'Invalid authentication code',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    return { mfaEnabled: false };
  }

  // ── Password reset ───────────────────────────────────────────────
  /** Always returns a generic result to avoid user enumeration. */
  async forgotPassword(email: string, tenantSlug?: string) {
    // SEC: without a tenantSlug the email may exist in several tenants; issue a
    // dedicated token + email per matching active user instead of letting a
    // findFirst pick an arbitrary tenant.
    const users = await this.prisma.user.findMany({
      where: {
        email,
        deletedAt: null,
        status: { not: 'inactive' },
        ...(tenantSlug ? { tenant: { slug: tenantSlug } } : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        tenant: { select: { slug: true } },
      },
    });
    const ttl = this.config.get<number>('app.passwordResetTtlSec', 1800);
    const base = this.config.get<string>(
      'app.appBaseUrl',
      'http://localhost:3000',
    );
    for (const user of users) {
      const token = await this.authTokens.issue(user.id, 'password_reset', ttl);
      await this.email.enqueue({
        to: user.email,
        template: 'password_reset',
        data: {
          name: user.firstName,
          tenantSlug: user.tenant.slug,
          url: `${base}/reset-password?token=${token}`,
          ttlMinutes: Math.round(ttl / 60),
        },
      });
    }
    return { message: 'If the account exists, a reset link has been sent.' };
  }

  /** Consume the reset token, set the new password, and kill all sessions. */
  async resetPassword(token: string, newPassword: string) {
    const userId = await this.authTokens.consume(token, 'password_reset');
    // SEC: deleted or non-active accounts must not be resurrected via reset.
    // Token is already consumed at this point; fail with the same generic error.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, deletedAt: true },
    });
    if (!user || user.deletedAt !== null || user.status !== 'active') {
      throw new BusinessException(
        'AUTH_TOKEN_INVALID',
        'Token is invalid, expired, or already used',
        HttpStatus.BAD_REQUEST,
      );
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { message: 'Password has been reset. Please log in again.' };
  }

  // ── Email verification ───────────────────────────────────────────
  async requestEmailVerification(userId: string) {
    const user = await this.requireUser(userId);
    if (user.emailVerifiedAt) {
      return { message: 'Email already verified.' };
    }
    const ttl = this.config.get<number>('app.emailVerifyTtlSec', 86400);
    const token = await this.authTokens.issue(user.id, 'email_verify', ttl);
    const base = this.config.get<string>(
      'app.appBaseUrl',
      'http://localhost:3000',
    );
    await this.email.enqueue({
      to: user.email,
      template: 'email_verification',
      data: {
        name: user.firstName,
        url: `${base}/verify-email?token=${token}`,
      },
    });
    return { message: 'Verification email sent.' };
  }

  async confirmEmailVerification(token: string) {
    const userId = await this.authTokens.consume(token, 'email_verify');
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { message: 'Email verified.' };
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        mfaEnabled: true,
        mfaSecret: true,
        emailVerifiedAt: true,
      },
    });
    if (!user) {
      throw new BusinessException(
        'AUTH_USER_NOT_FOUND',
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }
}
