import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { MinRole } from '../common/decorators/min-role.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ReassignReportsDto } from './dto/reassign-reports.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { SchedulesService } from '../schedules/schedules.service';
import { AssignScheduleDto } from '../schedules/dto/assign-schedule.dto';
import { BalancesService } from '../balances/balances.service';

@MinRole(Role.hr_admin)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly schedulesService: SchedulesService,
    private readonly balancesService: BalancesService,
  ) {}

  /**
   * 1. POST /users
   */
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async createUser(
    @CurrentUser('id') creatorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createUser(creatorId, orgId, dto);
  }

  /**
   * 2. GET /users
   */
  @Get()
  async getUsers(
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryUsersDto,
  ) {
    return this.usersService.getUsers(orgId, query);
  }

  /**
   * 3. GET /users/:id
   */
  @Get(':id')
  async getUserById(
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.getUserById(orgId, id);
  }

  /**
   * 4. PATCH /users/:id
   */
  @Patch(':id')
  async updateUser(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(actorId, orgId, id, dto);
  }

  /**
   * 5. PATCH /users/:id/deactivate
   */
  @Patch(':id/deactivate')
  async deactivateUser(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.deactivateUser(actorId, orgId, id);
  }

  /**
   * 5. PATCH /users/:id/reactivate
   */
  @Patch(':id/reactivate')
  async reactivateUser(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.usersService.reactivateUser(actorId, orgId, id);
  }

  /**
   * 6. POST /users/:id/reassign-reports
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/reassign-reports')
  async reassignReports(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: ReassignReportsDto,
  ) {
    return this.usersService.reassignReports(actorId, orgId, id, dto);
  }

  /**
   * 7. POST /users/:id/reset-password
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/reset-password')
  async resetPassword(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.usersService.resetPassword(actorId, orgId, id, dto);
  }

  /**
   * 8. POST /users/:id/schedule
   */
  @HttpCode(HttpStatus.CREATED)
  @Post(':id/schedule')
  async assignSchedule(
    @CurrentUser('id') creatorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') targetUserId: string,
    @Body() dto: AssignScheduleDto,
  ) {
    return this.schedulesService.assignSchedule(
      creatorId,
      orgId,
      targetUserId,
      dto,
    );
  }

  /**
   * 9. GET /users/:id/schedules
   */
  @Get(':id/schedules')
  async getUserSchedules(
    @CurrentUser('orgId') orgId: string,
    @Param('id') targetUserId: string,
  ) {
    return this.schedulesService.getUserSchedules(orgId, targetUserId);
  }

  /**
   * 10. GET /users/:id/balances
   */
  @Get(':id/balances')
  async getUserBalances(
    @CurrentUser('orgId') orgId: string,
    @Param('id') targetUserId: string,
    @Query('year') year?: string,
  ) {
    const yearNum = year ? parseInt(year, 10) : undefined;
    return this.balancesService.getUserBalances(orgId, targetUserId, yearNum);
  }
}
