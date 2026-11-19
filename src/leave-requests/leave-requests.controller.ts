import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MinRole } from '../common/decorators/min-role.decorator';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { CreateOnBehalfDto } from './dto/create-on-behalf.dto';
import { CancelApprovedLeaveDto } from './dto/cancel-approved.dto';
import { QueryAllRequestsDto } from './dto/query-all-requests.dto';

@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  /**
   * 1. POST /leave-requests
   * Submits a new leave request.
   */
  @HttpCode(HttpStatus.CREATED)
  @Post()
  async createLeaveRequest(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.createLeaveRequest(userId, orgId, role, dto);
  }

  /**
   * 2. POST /leave-requests/preview
   * Validates and returns preview without database commits or balance reservation.
   */
  @HttpCode(HttpStatus.OK)
  @Post('preview')
  async previewLeaveRequest(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @CurrentUser('role') role: Role,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leaveRequestsService.previewLeaveRequest(userId, orgId, role, dto);
  }

  /**
   * 3. POST /leave-requests/on-behalf (@MinRole(Role.hr_admin))
   * Submits a leave request on behalf of another user.
   */
  @MinRole(Role.hr_admin)
  @HttpCode(HttpStatus.CREATED)
  @Post('on-behalf')
  async applyOnBehalf(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Body() dto: CreateOnBehalfDto,
  ) {
    return this.leaveRequestsService.applyOnBehalf(callerId, callerRole, orgId, dto);
  }

  /**
   * 4. GET /leave-requests/mine
   * Returns personal leave request history.
   */
  @Get('mine')
  async getMyRequests(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryLeaveRequestsDto,
  ) {
    return this.leaveRequestsService.getMyRequests(userId, orgId, query);
  }

  /**
   * 5. GET /leave-requests (@MinRole(Role.hr_admin))
   * Paginated listing of all organization leave requests for HR history.
   */
  @MinRole(Role.hr_admin)
  @Get()
  async getAllRequests(
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryAllRequestsDto,
  ) {
    return this.leaveRequestsService.getAllRequests(orgId, query);
  }

  /**
   * 6. GET /leave-requests/:id
   * Detail view for the owner or HR Admin+.
   */
  @Get(':id')
  async getRequestById(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @CurrentUser('role') role: Role,
    @Param('id') id: string,
  ) {
    return this.leaveRequestsService.getRequestById(userId, orgId, role, id);
  }

  /**
   * 7. POST /leave-requests/:id/cancel
   * Cancels a pending request and releases reserved balances.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel')
  async cancelLeaveRequest(
    @CurrentUser('id') userId: string,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.leaveRequestsService.cancelLeaveRequest(userId, orgId, id);
  }

  /**
   * 8. POST /leave-requests/:id/cancel-approved (@MinRole(Role.hr_admin))
   * HR cancels an approved leave request, refunds balance to used, and logs audit.
   */
  @MinRole(Role.hr_admin)
  @HttpCode(HttpStatus.OK)
  @Post(':id/cancel-approved')
  async cancelApprovedLeave(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: CancelApprovedLeaveDto,
  ) {
    return this.leaveRequestsService.cancelApprovedRequest(
      callerId,
      callerRole,
      orgId,
      id,
      dto,
    );
  }
}
