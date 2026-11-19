import { Controller, Get } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinRole } from '../common/decorators/min-role.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('me')
  async getMe(
    @CurrentUser() caller: { id: string; role: Role; orgId: string },
  ) {
    return this.dashboardService.getMeDashboard(caller);
  }

  @Get('team')
  @MinRole(Role.manager)
  async getTeam(@CurrentUser() caller: { id: string; orgId: string }) {
    return this.dashboardService.getTeamDashboard(caller);
  }

  @Get('hr')
  @MinRole(Role.hr_admin)
  async getHr(
    @CurrentUser() caller: { id: string; role: Role; orgId: string },
  ) {
    return this.dashboardService.getHrDashboard(caller);
  }

  @Get('owner')
  @MinRole(Role.org_owner)
  async getOwner(
    @CurrentUser() caller: { id: string; role: Role; orgId: string },
  ) {
    return this.dashboardService.getOwnerDashboard(caller);
  }
}
