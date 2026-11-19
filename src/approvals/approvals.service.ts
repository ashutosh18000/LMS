import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RequestStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BalancesService } from '../balances/balances.service';
import { LeaveYearService } from '../balances/leave-year.service';
import { LeaveRequestsService } from '../leave-requests/leave-requests.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { DateUtil } from '../common/utils/date.util';
import { canDecide } from '../common/utils/decision-permission.util';
import { PaginatedResult } from '../common/dto/pagination.dto';
import { QueryPendingApprovalsDto } from './dto/query-pending-approvals.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balancesService: BalancesService,
    private readonly leaveYearService: LeaveYearService,
    private readonly leaveRequestsService: LeaveRequestsService,
    private readonly auditService: AuditService,
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
   * Returns complete request details and decision context (balances, monthlyUsage, teamConflicts).
   */
  async getApprovalById(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId, status: RequestStatus.pending },
      include: {
        organization: { select: { financialYearStartMonth: true } },
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
        creator: {
          select: { id: true, name: true, role: true },
        },
        segments: {
          include: {
            leaveType: {
              select: {
                id: true,
                name: true,
                isWfh: true,
                deductsBalance: true,
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
      throw new NotFoundException('Pending approval request not found');
    }

    // Authorization: caller must be able to decide this requester's request
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new NotFoundException('Pending approval request not found');
    }

    const startMonth = request.organization?.financialYearStartMonth ?? 4;

    // A. Balances for all deductsBalance leave types involved in this request
    const balances: Array<{
      leaveTypeId: string;
      leaveTypeName: string;
      year: number;
      allocated: any;
      used: any;
      pending: any;
      available: any;
    }> = [];

    const balanceKeys = new Set<string>();
    for (const seg of request.segments) {
      if (seg.leaveType.deductsBalance) {
        for (const day of request.segmentDays) {
          if (day.leaveTypeId === seg.leaveTypeId && Number(day.countedWeight) > 0) {
            const dateStr = DateUtil.format(day.date);
            const year = this.leaveYearService.leaveYearOf(dateStr, startMonth);
            const key = `${seg.leaveTypeId}_${year}`;
            balanceKeys.add(key);
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
            status: { in: [RequestStatus.pending, RequestStatus.approved] },
          },
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
      // Same managerId plus the manager themselves
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
      // Same department
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
            status: { in: [RequestStatus.pending, RequestStatus.approved] },
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
   * 3. POST /approvals/:id/approve (@MinRole(Role.HR_ADMIN))
   * Approves a pending request, commits reserved balances to used, and logs audit.
   */
  async approveRequest(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
    dto: ApproveRequestDto,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        user: { select: { id: true, role: true, orgId: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    // Permission rule check
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new ForbiddenException('Aap is request par decision nahi le sakte');
    }

    if (request.status !== RequestStatus.pending) {
      throw new ConflictException(
        `Sirf pending request approve ho sakti hai. Current status: ${request.status}`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Advisory lock on requester
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${request.userId}, 0::bigint))`,
        );

        // Update status to approved atomically
        const updateRes = await tx.leaveRequest.updateMany({
          where: { id, orgId, status: RequestStatus.pending },
          data: {
            status: RequestStatus.approved,
            decidedBy: callerId,
            decidedAt: new Date(),
            decisionComment: dto.comment ?? null,
          },
        });

        if (updateRes.count === 0) {
          throw new ConflictException('Request was updated concurrently or is no longer pending');
        }

        // Commit balances from pending to used
        const balances = await this.leaveRequestsService.calculateBalanceAmounts(tx, id);
        for (const b of balances) {
          await this.balancesService.commit(tx, request.userId, b.leaveTypeId, b.year, b.amount);
        }

        await this.auditService.log({
          orgId,
          actorId: callerId,
          targetUserId: request.userId,
          action: AuditAction.LEAVE_APPROVED,
          reason: dto.comment ?? null,
          metadata: {
            requestId: id,
            requesterId: request.userId,
            countedDays: request.countedDays ? request.countedDays.toString() : '0',
            comment: dto.comment ?? null,
          },
        });

        return {
          message: 'Leave request approved successfully',
          id,
          status: RequestStatus.approved,
        };
      },
      { timeout: 15000 },
    );
  }

  /**
   * 4. POST /approvals/:id/reject (@MinRole(Role.HR_ADMIN))
   * Rejects a pending request, releases reserved balances, and logs audit.
   */
  async rejectRequest(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
    dto: RejectRequestDto,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        user: { select: { id: true, role: true, orgId: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    // Permission rule check
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new ForbiddenException('Aap is request par decision nahi le sakte');
    }

    if (request.status !== RequestStatus.pending) {
      throw new ConflictException(
        `Sirf pending request reject ho sakti hai. Current status: ${request.status}`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Advisory lock on requester
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${request.userId}, 0::bigint))`,
        );

        // Update status to rejected atomically
        const updateRes = await tx.leaveRequest.updateMany({
          where: { id, orgId, status: RequestStatus.pending },
          data: {
            status: RequestStatus.rejected,
            decidedBy: callerId,
            decidedAt: new Date(),
            decisionComment: dto.comment,
          },
        });

        if (updateRes.count === 0) {
          throw new ConflictException('Request was updated concurrently or is no longer pending');
        }

        // Release reserved balances
        const balances = await this.leaveRequestsService.calculateBalanceAmounts(tx, id);
        for (const b of balances) {
          await this.balancesService.release(tx, request.userId, b.leaveTypeId, b.year, b.amount);
        }

        await this.auditService.log({
          orgId,
          actorId: callerId,
          targetUserId: request.userId,
          action: AuditAction.LEAVE_REJECTED,
          reason: dto.comment,
          metadata: {
            requestId: id,
            requesterId: request.userId,
            countedDays: request.countedDays ? request.countedDays.toString() : '0',
            comment: dto.comment,
          },
        });

        return {
          message: 'Leave request rejected successfully',
          id,
          status: RequestStatus.rejected,
        };
      },
      { timeout: 15000 },
    );
  }
}
