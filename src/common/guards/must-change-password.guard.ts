import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.mustChangePassword) {
      // Normalize URL (strip query parameters and potential trailing slashes)
      const path = (request.originalUrl || request.url || '')
        .split('?')[0]
        .replace(/\/+$/, '');

      const allowedPaths = [
        '/auth/change-password',
        '/auth/logout',
        '/auth/me',
      ];

      const isAllowed = allowedPaths.some(
        (allowed) => path === allowed || path.endsWith(allowed),
      );

      if (!isAllowed) {
        throw new ForbiddenException('Password change required');
      }
    }

    return true;
  }
}
