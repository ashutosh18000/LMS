import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SchedulesService } from './schedules.service';

@ApiTags('Work Schedules (HR Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('me')
export class MeScheduleController {
  constructor(private readonly schedulesService: SchedulesService) {}

  /**
   * GET /me/schedule
   * Accessible to all authenticated users.
   */
  @Get('schedule')
  async getMySchedule(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
  ) {
    return this.schedulesService.getMySchedule(userId, orgId);
  }
}
