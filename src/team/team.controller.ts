import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinRole } from '../common/decorators/min-role.decorator';
import { DateRangeDto, validateDateRange } from '../common/dto/date-range.dto';
import { TeamService } from './team.service';

@Controller('team')
@MinRole(Role.manager)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get('availability')
  async getAvailability(
    @CurrentUser() caller: { id: string; orgId: string },
    @Query() query: DateRangeDto,
  ) {
    validateDateRange(query.from, query.to, 92);
    return this.teamService.getTeamAvailability(caller, query.from, query.to);
  }

  @Get('availability/today')
  async getToday(@CurrentUser() caller: { id: string; orgId: string }) {
    return this.teamService.getTeamToday(caller);
  }
}
