import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MinRole } from '../src/common/decorators/min-role.decorator';
import { CurrentUser, CurrentUserPayload } from '../src/common/decorators/current-user.decorator';

@Controller('test-protected')
export class DummyProtectedController {
  @Get('general')
  getGeneral(@CurrentUser() user: CurrentUserPayload) {
    return {
      message: 'Access granted to authenticated user',
      userId: user.id,
      role: user.role,
    };
  }

  @MinRole(Role.hr_admin)
  @Get('hr-only')
  getHrOnly(@CurrentUser() user: CurrentUserPayload) {
    return {
      message: 'Access granted to HR or above',
      userId: user.id,
      role: user.role,
    };
  }

  @MinRole(Role.org_owner)
  @Get('owner-only')
  getOwnerOnly(@CurrentUser() user: CurrentUserPayload) {
    return {
      message: 'Access granted to Owner or above',
      userId: user.id,
      role: user.role,
    };
  }
}
