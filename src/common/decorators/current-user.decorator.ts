import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface CurrentUserPayload {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  mustChangePassword?: boolean;
}

export const CurrentUser = createParamDecorator(
  (
    data: keyof CurrentUserPayload | undefined,
    ctx: ExecutionContext,
  ): CurrentUserPayload | any => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
