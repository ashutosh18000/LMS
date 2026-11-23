import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgStatus, Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Validates access token by loading the user fresh from the database.
   * Role and orgId are NEVER trusted from the JWT payload itself.
   * If the user is inactive or their organization is suspended, revokes access immediately.
   */
  async validate(payload: JwtPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        orgId: true,
        mustChangePassword: true,
        active: true,
        organization: {
          select: { status: true },
        },
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    // Root user has orgId = null and is exempt from organization suspension check
    if (user.role !== Role.root) {
      if (!user.organization || user.organization.status === OrgStatus.suspended) {
        throw new UnauthorizedException('Organization is suspended');
      }
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
