import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RequestStatus, Role, SegmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';
import { LeaveYearService } from '../balances/leave-year.service';
import { LeaveRequestsService } from '../leave-requests/leave-requests.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import {
  DecidedSegmentNotificationItem,
  NotificationsService,
} from '../notifications/notifications.service';
import { DateUtil } from '../common/utils/date.util';
import { canDecide } from '../common/utils/decision-permission.util';
import { deriveRequestStatus } from '../common/utils/request-status.util';
import { PaginatedResult } from '../common/dto/pagination.dto';
import { QueryPendingApprovalsDto } from './dto/query-pending-approvals.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { DecideRequestDto } from './dto/decide-request.dto';
import { DecideResponseDto } from './dto/decide-response.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balancesService: BalancesService,
    private readonly leaveYearService: LeaveYearService,
    private readonly leaveRequestsService: LeaveRequestsService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * 1. GET /approvals/pending (@MinRole(Role.HR_ADMIN))
   * Returns paginated pending requests that the caller is authorized to decide.
   */
  async getPendingApprovals(
    callerId: string,
    callerRole: Role,
    orgId: string,
    query: QueryPendingApprovalsDto,
  ): Promise<PaginatedResult<any>> {
    const isOwner = callerRole === Role.org_owner || callerRole === Role.root;

    // Filter by caller's decision authority
    const roleFilter = isOwner
      ? query.onlyHrAdmins
        ? { in: [Role.hr_admin] }
        : { in: [Role.staff, Role.manager, Role.hr_admin] }
      : { in: [Role.staff, Role.manager] };

    const where: Prisma.LeaveRequestWhereInput = {
      orgId,
      status: RequestStatus.pending,
      user: {
        role: roleFilter,
        id: { not: callerId }, // Caller cannot decide own requests
        ...(query.department && {
          department: { contains: query.department, mode: 'insensitive' },
        }),
      },
      ...(query.userId && { userId: query.userId }),
      ...(query.leaveTypeId && {
        segments: {
          some: { leaveTypeId: query.leaveTypeId },
        },
      }),
      ...(query.from &&
        query.to && {
          segments: {
            some: {
              startDate: { lte: DateUtil.parse(query.to) },
              endDate: { gte: DateUtil.parse(query.from) },
            },
          },
        }),
      ...(query.from &&
        !query.to && {
          segments: {
            some: {
              endDate: { gte: DateUtil.parse(query.from) },
            },
          },
        }),
      ...(!query.from &&
        query.to && {
          segments: {
            some: {
              startDate: { lte: DateUtil.parse(query.to) },
            },
          },
        }),
    };

    const [total, requests] = await Promise.all([
      this.prisma.leaveRequest.count({ where }),
      this.prisma.leaveRequest.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'asc' }, // Oldest requests first
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              department: true,
            },
          },
          creator: {
            select: { id: true, name: true, role: true },
          },
          segments: {
            include: {
              leaveType: {
                select: { id: true, name: true, isWfh: true },
              },
            },
            orderBy: { startDate: 'asc' },
          },
        },
      }),
    ]);

    const items = requests.map((r) => ({
      id: r.id,
      requester: {
        id: r.user.id,
        name: r.user.name,
        role: r.user.role,
        department: r.user.department,
      },
      segments: r.segments.map((s) => ({
        id: s.id,
        leaveTypeId: s.leaveTypeId,
        leaveTypeName: s.leaveType.name,
        isWfh: s.leaveType.isWfh,
        startDate: DateUtil.format(s.startDate),
        endDate: DateUtil.format(s.endDate),
        portion: s.portion,
        countedDays: s.countedDays,
        status: s.status,
        decidedAt: s.decidedAt,
        decisionComment: s.decisionComment,
      })),
      reason: r.reason,
      spanDays: r.spanDays,
      countedDays: r.countedDays,
      createdAt: r.createdAt,
      createdBy: r.creator ? r.creator.name : null,
    }));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * 2. GET /approvals/:id (@MinRole(Role.HR_ADMIN))
   * Complete detail of pending request with balances, monthlyUsage, and teamConflicts context.
   */
  async getApprovalById(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            department: true,
            managerId: true,
            orgId: true,
          },
        },
        creator: { select: { id: true, name: true, role: true } },
        organization: { select: { financialYearStartMonth: true } },
        segments: {
          include: {
            leaveType: {
              select: {
                id: true,
                name: true,
                deductsBalance: true,
                isWfh: true,
                monthlyLimit: true,
              },
            },
          },
          orderBy: { startDate: 'asc' },
        },
        segmentDays: {
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    // Permission rule check
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new NotFoundException('Leave request not found');
    }

    // Context aggregation
    // A. Balances for leave types involved in this request
    const balances: Array<{
      leaveTypeId: string;
      leaveTypeName: string;
      year: number;
      allocated: Prisma.Decimal;
      used: Prisma.Decimal;
      pending: Prisma.Decimal;
      available: Prisma.Decimal;
    }> = [];

    const balanceKeys = new Set<string>();
    for (const seg of request.segments) {
      if (seg.leaveType.deductsBalance) {
        for (const day of request.segmentDays) {
          if (day.leaveTypeId === seg.leaveTypeId && Number(day.countedWeight) > 0) {
            const leaveYear = this.leaveYearService.leaveYearOf(
              day.date,
              request.organization.financialYearStartMonth,
            );
            balanceKeys.add(`${seg.leaveTypeId}_${leaveYear}`);
          }
        }
      }
    }

    for (const key of balanceKeys) {
      const [typeId, yearStr] = key.split('_');
      const year = parseInt(yearStr, 10);
      const leaveType = request.segments.find((s) => s.leaveTypeId === typeId)?.leaveType;

      const bal = await this.prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: request.user.id,
            leaveTypeId: typeId,
            year,
          },
        },
      });

      if (bal) {
        balances.push({
          leaveTypeId: typeId,
          leaveTypeName: leaveType?.name ?? '',
          year,
          allocated: bal.allocated,
          used: bal.used,
          pending: bal.pending,
          available: bal.allocated.minus(bal.used).minus(bal.pending),
        });
      }
    }

    // B. Monthly usage for leave types with monthlyLimit
    const monthlyUsage: Array<{
      leaveTypeId: string;
      leaveTypeName: string;
      month: string;
      limit: number;
      monthlyLimit: number;
      usedThisMonth: number;
    }> = [];

    const monthlyKeys = new Set<string>();
    for (const seg of request.segments) {
      if (seg.leaveType.monthlyLimit !== null) {
        for (const day of request.segmentDays) {
          if (day.leaveTypeId === seg.leaveTypeId && Number(day.countedWeight) > 0) {
            const dateStr = DateUtil.format(day.date);
            const monthStr = dateStr.substring(0, 7);
            const key = `${seg.leaveTypeId}_${monthStr}`;
            monthlyKeys.add(key);
          }
        }
      }
    }

    for (const key of monthlyKeys) {
      const [typeId, monthStr] = key.split('_');
      const leaveType = request.segments.find((s) => s.leaveTypeId === typeId)?.leaveType;
      const [yStr, mStr] = monthStr.split('-');
      const startOfMonth = DateUtil.parse(`${monthStr}-01`);
      const endOfMonth = new Date(Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10), 0));

      const existingAgg = await this.prisma.leaveSegmentDay.aggregate({
        where: {
          userId: request.user.id,
          orgId,
          leaveTypeId: typeId,
          date: { gte: startOfMonth, lte: endOfMonth },
          request: {
            status: { in: [RequestStatus.pending, RequestStatus.approved, RequestStatus.partially_approved] },
          },
          occupancy: { gt: 0 },
        },
        _sum: { countedWeight: true },
      });

      const usedThisMonth = existingAgg._sum.countedWeight
        ? Number(existingAgg._sum.countedWeight)
        : 0;

      monthlyUsage.push({
        leaveTypeId: typeId,
        leaveTypeName: leaveType?.name ?? '',
        month: monthStr,
        limit: Number(leaveType?.monthlyLimit),
        monthlyLimit: Number(leaveType?.monthlyLimit),
        usedThisMonth,
      });
    }

    // C. Team conflicts: others on leave/WFH on the same dates
    let teamUserIds: string[] = [];
    if (request.user.managerId) {
      const teamUsers = await this.prisma.user.findMany({
        where: {
          orgId,
          active: true,
          OR: [
            { managerId: request.user.managerId },
            { id: request.user.managerId },
          ],
        },
        select: { id: true },
      });
      teamUserIds = teamUsers.map((u) => u.id).filter((id) => id !== request.user.id);
    } else if (request.user.department) {
      const teamUsers = await this.prisma.user.findMany({
        where: {
          orgId,
          department: request.user.department,
          active: true,
        },
        select: { id: true },
      });
      teamUserIds = teamUsers.map((u) => u.id).filter((id) => id !== request.user.id);
    }

    const occupiedDates = request.segmentDays
      .filter((d) => Number(d.occupancy) > 0)
      .map((d) => d.date);

    let teamConflicts: Array<{
      userId: string;
      userName: string;
      date: string;
      leaveTypeId: string;
      leaveTypeName: string;
      isWfh: boolean;
      status: RequestStatus;
      requestId: string;
    }> = [];

    if (teamUserIds.length > 0 && occupiedDates.length > 0) {
      const conflictDays = await this.prisma.leaveSegmentDay.findMany({
        where: {
          orgId,
          userId: { in: teamUserIds },
          date: { in: occupiedDates },
          occupancy: { gt: 0 },
          request: {
            status: { in: [RequestStatus.pending, RequestStatus.approved, RequestStatus.partially_approved] },
          },
        },
        include: {
          user: { select: { id: true, name: true } },
          leaveType: { select: { id: true, name: true, isWfh: true } },
          request: { select: { id: true, status: true } },
        },
        orderBy: [{ date: 'asc' }, { user: { name: 'asc' } }],
      });

      teamConflicts = conflictDays.map((cd) => ({
        userId: cd.user.id,
        userName: cd.user.name,
        date: DateUtil.format(cd.date),
        leaveTypeId: cd.leaveTypeId,
        leaveTypeName: cd.leaveType.name,
        isWfh: cd.leaveType.isWfh,
        status: cd.request.status,
        requestId: cd.requestId,
      }));
    }

    return {
      id: request.id,
      requester: {
        id: request.user.id,
        name: request.user.name,
        email: request.user.email,
        role: request.user.role,
        department: request.user.department,
      },
      reason: request.reason,
      status: request.status,
      spanDays: request.spanDays,
      countedDays: request.countedDays,
      createdAt: request.createdAt,
      createdBy: request.creator ? request.creator.name : null,
      segments: request.segments.map((s) => ({
        id: s.id,
        leaveTypeId: s.leaveTypeId,
        leaveTypeName: s.leaveType.name,
        isWfh: s.leaveType.isWfh,
        startDate: DateUtil.format(s.startDate),
        endDate: DateUtil.format(s.endDate),
        portion: s.portion,
        countedDays: s.countedDays,
        status: s.status,
        decidedAt: s.decidedAt,
        decisionComment: s.decisionComment,
      })),
      segmentDays: request.segmentDays.map((d) => ({
        id: d.id,
        date: DateUtil.format(d.date),
        leaveTypeId: d.leaveTypeId,
        occupancy: d.occupancy,
        countedWeight: d.countedWeight,
        skipReason: d.skipReason,
      })),
      context: {
        balances,
        monthlyUsage,
        teamConflicts,
      },
    };
  }

  /**
   * 3. POST /approvals/:id/decide (@MinRole(Role.HR_ADMIN))
   * Submits atomic segment-wise decisions for ALL pending segments of a request.
   */
  async decideRequest(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
    dto: DecideRequestDto,
  ): Promise<DecideResponseDto> {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        user: { select: { id: true, name: true, role: true, orgId: true, managerId: true } },
        organization: { select: { financialYearStartMonth: true } },
        segments: {
          include: {
            leaveType: { select: { id: true, name: true, deductsBalance: true, isWfh: true } },
            segmentDays: {
              select: { id: true, date: true, countedWeight: true, occupancy: true },
            },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAVE_REQUEST_NOT_FOUND',
        message: 'Leave request not found',
      });
    }

    // Permission rule check
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'NOT_AUTHORIZED_TO_DECIDE',
        message: 'You are not authorized to decide on this request',
      });
    }

    if (request.status !== RequestStatus.pending) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ONLY_PENDING_CAN_BE_DECIDED',
        message: `Only pending requests can be decided. Current status: ${request.status}`,
      });
    }

    const pendingSegments = request.segments.filter((s) => s.status === SegmentStatus.pending);
    if (pendingSegments.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        code: 'NO_PENDING_SEGMENTS',
        message: 'No pending segments found for this request',
      });
    }

    // Validate that every pending segment has an entry in dto.decisions
    const decisionMap = new Map<string, { segmentId: string; action: 'approve' | 'reject'; comment?: string }>();
    for (const d of dto.decisions) {
      decisionMap.set(d.segmentId, d);
    }

    const missingSegments: string[] = [];
    for (const seg of pendingSegments) {
      if (!decisionMap.has(seg.id)) {
        missingSegments.push(seg.id);
      }
    }

    if (missingSegments.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'MISSING_SEGMENT_DECISIONS',
        message: `A decision is required for every pending segment. Missing segment(s): ${missingSegments.join(', ')}`,
      });
    }

    // Validate no extraneous segment IDs
    const pendingSegmentIds = new Set(pendingSegments.map((s) => s.id));
    for (const d of dto.decisions) {
      if (!pendingSegmentIds.has(d.segmentId)) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'INVALID_SEGMENT_ID',
          message: `Invalid or non-pending segment ID: ${d.segmentId}`,
 });
      }
    }

    // Validate reject comment is mandatory
    for (const d of dto.decisions) {
      if (d.action === 'reject') {
        if (!d.comment || !d.comment.trim()) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'DECISION_COMMENT_REQUIRED',
            message: 'A comment is required for every rejected segment',
          });
        }
      }
    }

    // Derive request status based on all segment statuses (decided pending + existing)
    const resultingStatuses = request.segments.map((seg) => {
      const decision = decisionMap.get(seg.id);
      if (decision) {
        return decision.action === 'approve' ? SegmentStatus.approved : SegmentStatus.rejected;
      }
      return seg.status;
    });
    const derivedStatus = deriveRequestStatus(resultingStatuses);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Transaction-level advisory lock on requester ID
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${request.userId}, 0::bigint))`,
      );

      // 2. Conditional status update on LeaveRequest: WHERE status = 'pending'
      const lastComment = dto.decisions.find((d) => d.comment?.trim())?.comment?.trim() ?? null;
      const now = new Date();

      const updateRes = await tx.leaveRequest.updateMany({
        where: { id, orgId, status: RequestStatus.pending },
        data: {
          status: derivedStatus,
          decidedBy: callerId,
          decidedAt: now,
          decisionComment: lastComment,
        },
      });

      if (updateRes.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CONCURRENT_UPDATE',
          message: 'Request was updated concurrently or is no longer pending',
        });
      }

      const decidedSegmentsResponse: Array<{ id: string; status: SegmentStatus; comment?: string | null }> = [];
      const notificationSegments: DecidedSegmentNotificationItem[] = [];

      // 3. For each segment, update status conditionally and commit/release balances
      for (const seg of pendingSegments) {
        const decision = decisionMap.get(seg.id)!;
        const newSegmentStatus =
          decision.action === 'approve' ? SegmentStatus.approved : SegmentStatus.rejected;
        const segmentComment = decision.comment ? decision.comment.trim() : null;

        const segUpdateRes = await tx.leaveSegment.updateMany({
          where: { id: seg.id, requestId: id, status: SegmentStatus.pending },
          data: {
            status: newSegmentStatus,
            decidedBy: callerId,
            decidedAt: now,
            decisionComment: segmentComment,
          },
        });

        if (segUpdateRes.count === 0) {
          throw new ConflictException({
            statusCode: 409,
            code: 'CONCURRENT_UPDATE',
            message: `Segment ${seg.id} was updated concurrently or is no longer pending`,
          });
        }

        // If rejected, set occupancy = 0 so dates are freed up immediately
        if (decision.action === 'reject') {
          await tx.leaveSegmentDay.updateMany({
            where: { segmentId: seg.id },
            data: { occupancy: 0 },
          });
        }

        // Balance handling: only if leave type deductsBalance is true
        if (seg.leaveType.deductsBalance) {
          const segmentBalances = this.leaveRequestsService.calculateBalanceAmountsFromDays(
            request.organization?.financialYearStartMonth ?? 4,
            seg.segmentDays.map((d) => ({
              leaveTypeId: seg.leaveTypeId,
              date: d.date,
              countedWeight: d.countedWeight,
              leaveType: { deductsBalance: true },
            })),
          );

          for (const b of segmentBalances) {
            if (decision.action === 'approve') {
              await this.balancesService.commit(tx, request.userId, b.leaveTypeId, b.year, b.amount);
            } else {
              await this.balancesService.release(tx, request.userId, b.leaveTypeId, b.year, b.amount);
            }
          }
        }

        // Audit log per segment decision
        await this.auditService.log(
          {
            orgId,
            actorId: callerId,
            targetUserId: request.userId,
            action:
              decision.action === 'approve'
                ? AuditAction.LEAVE_APPROVED
                : AuditAction.LEAVE_REJECTED,
            reason: segmentComment,
            metadata: {
              requestId: id,
              requesterId: request.userId,
              segmentId: seg.id,
              action: decision.action,
              comment: segmentComment,
              leaveTypeId: seg.leaveTypeId,
              countedDays: seg.countedDays ? seg.countedDays.toString() : '0',
            },
          },
          tx,
        );

        decidedSegmentsResponse.push({
          id: seg.id,
          status: newSegmentStatus,
          comment: segmentComment,
        });

        notificationSegments.push({
          id: seg.id,
          isWfh: seg.leaveType.isWfh,
          startDate: seg.startDate,
          endDate: seg.endDate,
          portion: seg.portion,
          status: newSegmentStatus,
          comment: segmentComment,
        });
      }

      // 4. Create in-app notifications
      await this.notificationsService.createDecisionNotifications(tx, {
        orgId,
        requestId: id,
        requestStatus: derivedStatus,
        actorId: callerId,
        requester: {
          id: request.user.id,
          name: request.user.name,
          managerId: request.user.managerId,
        },
        segments: notificationSegments,
      });

      return {
        message: 'Leave request decided successfully',
        id,
        status: derivedStatus,
        segments: decidedSegmentsResponse,
      };
    });

    return result;
  }

  /**
   * 4. POST /approvals/:id/approve (@MinRole(Role.HR_ADMIN))
   * Shortcut to approve all pending segments.
   */
  async approveRequest(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
    dto: ApproveRequestDto,
  ): Promise<DecideResponseDto> {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        segments: true,
      },
    });

    if (!request) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAVE_REQUEST_NOT_FOUND',
        message: 'Leave request not found',
      });
    }

    if (request.status !== RequestStatus.pending) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ONLY_PENDING_CAN_BE_APPROVED',
        message: `Only pending requests can be approved. Current status: ${request.status}`,
      });
    }

    const pendingSegments = request.segments.filter((s) => s.status === SegmentStatus.pending);
    const decisions = pendingSegments.map((s) => ({
      segmentId: s.id,
      action: 'approve' as const,
      comment: dto.comment,
    }));

    const result = await this.decideRequest(callerId, callerRole, orgId, id, { decisions });
    return {
      ...result,
      message: 'Leave request approved successfully',
    };
  }

  /**
   * 5. POST /approvals/:id/reject (@MinRole(Role.HR_ADMIN))
   * Shortcut to reject all pending segments (comment required).
   */
  async rejectRequest(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
    dto: RejectRequestDto,
  ): Promise<DecideResponseDto> {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        segments: true,
      },
    });

    if (!request) {
      throw new NotFoundException({
        statusCode: 404,
        code: 'LEAVE_REQUEST_NOT_FOUND',
        message: 'Leave request not found',
      });
    }

    if (request.status !== RequestStatus.pending) {
      throw new ConflictException({
        statusCode: 409,
        code: 'ONLY_PENDING_CAN_BE_REJECTED',
        message: `Only pending requests can be rejected. Current status: ${request.status}`,
      });
    }

    const pendingSegments = request.segments.filter((s) => s.status === SegmentStatus.pending);
    const decisions = pendingSegments.map((s) => ({
      segmentId: s.id,
      action: 'reject' as const,
      comment: dto.comment,
    }));

    const result = await this.decideRequest(callerId, callerRole, orgId, id, { decisions });
    return {
      ...result,
      message: 'Leave request rejected successfully',
    };
  }
}
