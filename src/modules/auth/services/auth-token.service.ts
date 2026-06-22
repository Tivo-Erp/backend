import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../infra/database/prisma.service.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';

export type AuthTokenType = 'password_reset' | 'email_verify' | 'mfa_challenge';

/**
 * Single-use, hashed credentials for the SEC-001 flows (password reset, email
 * verification, MFA login challenge). Only the SHA-256 hash is stored, so a DB
 * read never yields a usable token; consumption is atomic (claim via
 * `updateMany` on `usedAt: null`) so a token cannot be redeemed twice.
 */
@Injectable()
export class AuthTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Issue a new token, returning the raw value (shown once to the user). */
  async issue(
    userId: string,
    type: AuthTokenType,
    ttlSec: number,
  ): Promise<string> {
    const raw = `${randomBytes(32).toString('base64url')}`;
    await this.prisma.authToken.create({
      data: {
        userId,
        type,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      },
    });
    return raw;
  }

  /**
   * Atomically consume a token of the given type. Returns the owning userId, or
   * throws `AUTH_TOKEN_INVALID` when missing / wrong-type / expired / already used.
   */
  async consume(raw: string, type: AuthTokenType): Promise<string> {
    const tokenHash = this.hash(raw ?? '');
    const claimed = await this.prisma.authToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new BusinessException(
        'AUTH_TOKEN_INVALID',
        'Token is invalid, expired, or already used',
        HttpStatus.BAD_REQUEST,
      );
    }
    const row = await this.prisma.authToken.findFirst({
      where: { tokenHash, type },
      select: { userId: true },
    });
    return row!.userId;
  }
}
