import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { MIN_ROLE_KEY } from '../decorators/min-role.decorator';

export const ROLE_RANK: Record<Role, number> = {
  [Role.staff]: 1,
  [Role.manager]: 2,
  [Role.hr_admin]: 3,
  [Role.org_owner]: 4,
  [Role.root]: 5,
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRole = this.reflector.getAllAndOverride<Role>(MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRole) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.role) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const userRank = ROLE_RANK[user.role as Role] ?? 0;
    const requiredRank = ROLE_RANK[requiredRole] ?? 999;

    if (userRank < requiredRank) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
