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
import { ApprovalsService } from './approvals.service';
import { QueryPendingApprovalsDto } from './dto/query-pending-approvals.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('Approvals (HR Admin)')
@ApiBearerAuth('JWT-auth')
@MinRole(Role.hr_admin)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  /**
   * 1. GET /approvals/pending
   * Returns list of pending requests that the caller is authorized to decide.
   */
  @Get('pending')
  async getPendingApprovals(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Query() query: QueryPendingApprovalsDto,
  ) {
    return this.approvalsService.getPendingApprovals(
      callerId,
      callerRole,
      orgId,
      query,
    );
  }

  /**
   * 2. GET /approvals/:id
   * Complete detail of pending request with balances, monthlyUsage, and teamConflicts context.
   */
  @Get(':id')
  async getApprovalById(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.approvalsService.getApprovalById(
      callerId,
      callerRole,
      orgId,
      id,
    );
  }

  /**
   * 3. POST /approvals/:id/approve
   * Approves a pending request and commits balance from pending to used.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  async approveRequest(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.approvalsService.approveRequest(
      callerId,
      callerRole,
      orgId,
      id,
      dto,
    );
  }

  /**
   * 4. POST /approvals/:id/reject
   * Rejects a pending request and releases reserved balances.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  async rejectRequest(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
  ) {
    return this.approvalsService.rejectRequest(
      callerId,
      callerRole,
      orgId,
      id,
      dto,
    );
  }
}
