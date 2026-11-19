import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';

@Injectable()
export class OrgScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Unauthenticated or public requests pass downstream
    if (!user || !user.role) {
      return true;
    }

    const rawPath = request.path || request.url || '';
    const path = rawPath.split('?')[0];

    if (user.role === Role.root) {
      // Root is platform-level: only /platform/*, /auth/*, and /health allowed
      const isAllowedForRoot =
        path === '/platform' ||
        path.startsWith('/platform/') ||
        path === '/auth' ||
        path.startsWith('/auth/') ||
        path === '/health' ||
        path.startsWith('/health/');

      if (!isAllowedForRoot) {
        throw new ForbiddenException('Root org ke andar kaam nahi karta');
      }
      return true;
    }

    // Non-root users cannot access platform endpoints
    if (path === '/platform' || path.startsWith('/platform/')) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
