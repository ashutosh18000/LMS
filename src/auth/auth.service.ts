import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { OrgStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';
import { AuditService } from '../audit/audit.service';
import { LoginAttemptService } from './login-attempt.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokensService: TokensService,
    private readonly auditService: AuditService,
    private readonly loginAttemptService: LoginAttemptService,
  ) {}

  /**
   * 1. POST /auth/login
   * Validates credentials with timing-attack mitigation.
   * Returns accessToken in body and sets refreshToken in httpOnly cookie.
   */
  async login(dto: LoginDto, res: Response) {
    const email = dto.email.toLowerCase().trim();

    const { blocked, retryAfterSeconds } = this.loginAttemptService.isBlocked(email);
    if (blocked) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many failed login attempts. Please try again later.',
          details: null,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        organization: true,
      },
    });

    if (!user) {
      this.loginAttemptService.recordFailedAttempt(email);
      // Execute dummy comparison to mitigate timing attacks revealing user existence
      await this.passwordService.dummyCompare(dto.password);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.passwordService.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      this.loginAttemptService.recordFailedAttempt(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.loginAttemptService.resetAttempts(email);

    if (!user.active) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Verify organization is active for non-root users
    if (user.role !== Role.root) {
      if (!user.organization || user.organization.status === OrgStatus.suspended) {
        throw new UnauthorizedException('Organization is suspended');
      }
    }

    const accessToken = await this.tokensService.generateAccessToken(user.id);
    const { rawToken } = await this.tokensService.createRefreshToken(user.id);

    this.tokensService.setRefreshTokenCookie(res, rawToken);

    return {
      accessToken,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
      },
    };
  }

  /**
   * 2. POST /auth/refresh
   * Verifies incoming cookie refreshToken, rotates it in a transaction.
   * On token reuse or mismatch, revokes all tokens of that user.
   */
  async refresh(rawToken: string | undefined, res: Response) {
    if (!rawToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const payload = this.tokensService.verifyRefreshToken(rawToken);

    // Verify user status fresh from DB
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { organization: true },
    });

    if (!user || !user.active) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: payload.sub },
      });
      this.tokensService.clearRefreshTokenCookie(res);
      throw new UnauthorizedException('Account is inactive or not found');
    }

    if (user.role !== Role.root && user.organization?.status === OrgStatus.suspended) {
      await this.prisma.refreshToken.deleteMany({
        where: { userId: payload.sub },
      });
      this.tokensService.clearRefreshTokenCookie(res);
      throw new UnauthorizedException('Organization is suspended');
    }

    const tokenRow = await this.prisma.refreshToken.findUnique({
      where: { id: payload.jti },
    });

    const incomingHash = this.tokensService.hashToken(rawToken);

    // Reuse detection: If row does not exist or stored hash does not match
    if (!tokenRow || tokenRow.tokenHash !== incomingHash) {
      // Invalidate all sessions for this compromised user
      await this.prisma.refreshToken.deleteMany({
        where: { userId: payload.sub },
      });
      this.tokensService.clearRefreshTokenCookie(res);
      throw new UnauthorizedException('Invalid or reused refresh token');
    }

    // Atomic rotation: delete old row, insert new row
    const { newRawToken, newAccessToken } = await this.prisma.$transaction(
      async (tx) => {
        await tx.refreshToken.delete({
          where: { id: payload.jti },
        });

        const { rawToken: rotatedToken } =
          await this.tokensService.createRefreshToken(user.id, tx);
        const accessToken =
          await this.tokensService.generateAccessToken(user.id);

        return {
          newRawToken: rotatedToken,
          newAccessToken: accessToken,
        };
      },
    );

    this.tokensService.setRefreshTokenCookie(res, newRawToken);

    return {
      accessToken: newAccessToken,
    };
  }

  /**
   * 3. POST /auth/logout
   * Deletes the active refresh token row and clears cookie.
   * Returns 200 OK even if cookie was missing or expired.
   */
  async logout(rawToken: string | undefined, res: Response) {
    if (rawToken) {
      try {
        const payload = this.tokensService.verifyRefreshToken(rawToken);
        await this.prisma.refreshToken.deleteMany({
          where: { id: payload.jti },
        });
      } catch {
        // Silently proceed on malformed/expired token
      }
    }

    this.tokensService.clearRefreshTokenCookie(res);
    return {
      message: 'Logged out successfully',
    };
  }

  /**
   * 4. POST /auth/change-password
   * Enforces password change rules, revokes old refresh tokens,
   * sets new refresh token so user stays logged in, and writes audit log.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    res: Response,
  ) {
    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password cannot be the same as the old password',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const isMatch = await this.passwordService.compare(
      dto.oldPassword,
      user.passwordHash,
    );

    if (!isMatch) {
      throw new UnauthorizedException('Invalid current password');
    }

    const newPasswordHash = await this.passwordService.hash(dto.newPassword);

    const { newRawToken, newAccessToken } = await this.prisma.$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            passwordHash: newPasswordHash,
            mustChangePassword: false,
          },
        });

        // Revoke all prior refresh tokens
        await tx.refreshToken.deleteMany({
          where: { userId },
        });

        // Issue new refresh token so user remains authenticated
        const { rawToken } = await this.tokensService.createRefreshToken(
          userId,
          tx,
        );
        const accessToken =
          await this.tokensService.generateAccessToken(userId);

        return {
          newRawToken: rawToken,
          newAccessToken: accessToken,
        };
      },
    );

    // Record immutable audit log
    await this.auditService.log({
      orgId: user.orgId,
      actorId: user.id,
      targetUserId: user.id,
      action: 'USER_PASSWORD_CHANGE',
      reason: 'User changed password successfully',
      metadata: {
        mustChangePasswordPrevious: user.mustChangePassword,
        mustChangePasswordCurrent: false,
      },
    });

    this.tokensService.setRefreshTokenCookie(res, newRawToken);

    return {
      accessToken: newAccessToken,
      message: 'Password changed successfully',
    };
  }

  /**
   * 5. GET /auth/me
   * Returns current authenticated user profile.
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
