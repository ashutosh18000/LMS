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
import { LeaveTypesService } from './leave-types.service';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Leave Types (HR Admin)')
@ApiBearerAuth('JWT-auth')
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly leaveTypesService: LeaveTypesService) {}

  /**
   * 1. POST /leave-types
   */
  @MinRole(Role.hr_admin)
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async createLeaveType(
    @CurrentUser('id') creatorId: string,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    return this.leaveTypesService.createLeaveType(creatorId, orgId, dto);
  }

  /**
   * 2. GET /leave-types
   * Accessible to all logged-in users.
   */
  @Get()
  async getLeaveTypes(
    @CurrentUser('orgId') orgId: string,
    @CurrentUser('role') userRole: Role,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.leaveTypesService.getLeaveTypes(
      orgId,
      userRole,
      includeInactive === 'true',
    );
  }

  /**
   * 2b. GET /leave-types/:id
   * Accessible to all logged-in users.
   */
  @Get(':id')
  async getLeaveTypeById(
    @CurrentUser('orgId') orgId: string,
    @CurrentUser('role') userRole: Role,
    @Param('id') id: string,
  ) {
    return this.leaveTypesService.getLeaveTypeById(orgId, id, userRole);
  }

  /**
   * 3. PATCH /leave-types/:id
   */
  @MinRole(Role.hr_admin)
  @Patch(':id')
  async updateLeaveType(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leaveTypesService.updateLeaveType(actorId, orgId, id, dto);
  }

  /**
   * 4. PATCH /leave-types/:id/deactivate
   */
  @MinRole(Role.hr_admin)
  @Patch(':id/deactivate')
  async deactivateLeaveType(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.leaveTypesService.deactivateLeaveType(actorId, orgId, id);
  }

  /**
   * 4. PATCH /leave-types/:id/reactivate
   */
  @MinRole(Role.hr_admin)
  @Patch(':id/reactivate')
  async reactivateLeaveType(
    @CurrentUser('id') actorId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.leaveTypesService.reactivateLeaveType(actorId, orgId, id);
  }
}
