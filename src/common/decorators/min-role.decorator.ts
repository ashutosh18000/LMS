import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const MIN_ROLE_KEY = 'minRole';
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE_KEY, role);
