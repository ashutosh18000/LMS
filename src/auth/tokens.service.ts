import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class TokensService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly isProduction: boolean;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';
  private readonly cookieDomain?: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.accessSecret = configService.get<string>('JWT_ACCESS_SECRET') || '';
    this.refreshSecret = configService.get<string>('JWT_REFRESH_SECRET') || '';
    this.isProduction = configService.get<string>('NODE_ENV') === 'production';

    const sameSiteRaw = (configService.get<string>('COOKIE_SAMESITE') || 'strict').toLowerCase();
    this.cookieSameSite = ['strict', 'lax', 'none'].includes(sameSiteRaw)
      ? (sameSiteRaw as 'strict' | 'lax' | 'none')
      : 'strict';
    this.cookieDomain = configService.get<string>('COOKIE_DOMAIN') || undefined;

    if (!this.accessSecret || !this.refreshSecret) {
      throw new Error(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be configured',
      );
    }
  }

  private getCookieOptions() {
    const secure = this.cookieSameSite === 'none' ? true : this.isProduction;
    return {
      httpOnly: true,
      secure,
      sameSite: this.cookieSameSite,
      path: '/auth',
      ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
    };
  }

  /**
   * Hashes a raw refresh token using SHA-256 for secure storage.
   * Bcrypt is deliberately NOT used because bcrypt truncates at 72 bytes,
   * whereas JWT refresh tokens are longer.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates a 15-minute access token containing only the user ID as sub.
   */
  async generateAccessToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.accessSecret,
        expiresIn: '15m',
      },
    );
  }

  /**
   * Generates a new refresh token and persists its SHA-256 hash in the database.
   * Raw token is never stored.
   */
  async createRefreshToken(
    userId: string,
    prismaClient: any = this.prisma,
  ): Promise<{ rawToken: string; jti: string; expiresAt: Date }> {
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const rawToken = await this.jwtService.signAsync(
      { sub: userId, jti },
      {
        secret: this.refreshSecret,
        expiresIn: '7d',
      },
    );

    const tokenHash = this.hashToken(rawToken);

    await prismaClient.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return { rawToken, jti, expiresAt };
  }

  /**
   * Verifies the cryptographic signature of an incoming refresh token.
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwtService.verify<RefreshTokenPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Sets the refresh token into a secure httpOnly cookie.
   */
  setRefreshTokenCookie(res: Response, rawToken: string): void {
    res.cookie('refreshToken', rawToken, {
      ...this.getCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  /**
   * Clears the refresh token cookie.
   */
  clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refreshToken', this.getCookieOptions());
  }

  /**
   * Deletes all expired refresh tokens from the database.
   */
  async cleanupExpiredTokens(): Promise<{ count: number }> {
    return this.prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }
}
