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
import { DecideRequestDto } from './dto/decide-request.dto';
import { DecideResponseDto } from './dto/decide-response.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

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
  @ApiOperation({ summary: 'List pending leave requests awaiting approval' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated pending approvals' })
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
  @ApiOperation({ summary: 'Get approval request detail with balances and conflict context' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Approval detail and context' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Leave request not found' })
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
   * 3. POST /approvals/:id/decide
   * Submits atomic segment-wise decisions for all pending segments of a request.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/decide')
  @ApiOperation({ summary: 'Submit segment-wise decision for all pending segments of a request' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Decision recorded successfully',
    type: DecideResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Incomplete decisions or missing comment for rejected segment',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller not authorized to decide on this request',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Concurrent update or request not in pending state',
  })
  async decideRequest(
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: Role,
    @CurrentUser('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: DecideRequestDto,
  ): Promise<DecideResponseDto> {
    return this.approvalsService.decideRequest(
      callerId,
      callerRole,
      orgId,
      id,
      dto,
    );
  }

  /**
   * 4. POST /approvals/:id/approve
   * Shortcut to approve all pending segments and commit balance from pending to used.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  @ApiOperation({ summary: 'Shortcut: approve all pending segments of a request' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Request approved successfully',
    type: DecideResponseDto,
  })
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
   * 5. POST /approvals/:id/reject
   * Shortcut to reject all pending segments (comment required) and release reserved balances.
   */
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  @ApiOperation({ summary: 'Shortcut: reject all pending segments of a request' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Request rejected successfully',
    type: DecideResponseDto,
  })
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
