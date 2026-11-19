import { Injectable } from '@nestjs/common';
import { RequestStatus, Role, SkipReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../common/services/clock.service';
import { LeaveYearService } from '../balances/leave-year.service';
import { AvailabilityService } from '../common/services/availability.service';
import { DateUtil } from '../common/utils/date.util';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clockService: ClockService,
    private readonly leaveYearService: LeaveYearService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  /**
   * Helper to get org's current today string based on org timezone.
   */
  private async getOrgToday(orgId: string): Promise<{
    today: string;
    timezone: string;
    financialYearStartMonth: number;
  }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true, financialYearStartMonth: true },
    });
    const timezone = org?.timezone ?? 'UTC';
    const today = this.clockService.today(timezone);
    return {
      today,
      timezone,
      financialYearStartMonth: org?.financialYearStartMonth ?? 4,
    };
  }

  /**
   * 1. GET /dashboard/me
   * Personal overview: balances, upcoming leaves (next 30d), pending requests, and next 3 holidays.
   */
  async getMeDashboard(caller: { id: string; role: Role; orgId: string }) {
    const { today, financialYearStartMonth } = await this.getOrgToday(
      caller.orgId,
    );

    // Common: next 3 holidays
    const holidays = await this.prisma.holiday.findMany({
      where: {
        orgId: caller.orgId,
        active: true,
        date: { gte: DateUtil.parse(today) },
      },
      orderBy: { date: 'asc' },
      take: 3,
    });
    const upcomingHolidays = holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: DateUtil.format(h.date),
    }));

    // Org Owner does not have personal leave balances or leave requests
    if (caller.role === Role.org_owner) {
      return {
        balances: [],
        upcomingLeaves: [],
        pendingRequests: {
          count: 0,
          items: [],
        },
        upcomingHolidays,
      };
    }

    // A. Balances for current leave year
    const curYear = this.leaveYearService.leaveYearOf(
      today,
      financialYearStartMonth,
    );

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        userId: caller.id,
        orgId: caller.orgId,
        year: curYear,
      },
      include: {
        leaveType: {
          select: {
            id: true,
            name: true,
            isWfh: true,
            monthlyLimit: true,
          },
        },
      },
      orderBy: { leaveType: { name: 'asc' } },
    });

    // Calendar month bounds for monthly limit calculation
    const [yStr, mStr] = today.split('-');
    const startOfMonth = DateUtil.parse(`${yStr}-${mStr}-01`);
    const endOfMonth = new Date(
      Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10), 0),
    );

    const balanceItems = await Promise.all(
      balances.map(async (b) => {
        const allocated = Number(b.allocated);
        const used = Number(b.used);
        const pending = Number(b.pending);
        const available = Number((allocated - used - pending).toFixed(1));

        let usedThisMonth: number | undefined;
        if (b.leaveType.monthlyLimit !== null) {
          const monthUsageAgg = await this.prisma.leaveSegmentDay.aggregate({
            where: {
              userId: caller.id,
              orgId: caller.orgId,
              leaveTypeId: b.leaveTypeId,
              date: { gte: startOfMonth, lte: endOfMonth },
              request: {
                status: {
                  in: [RequestStatus.pending, RequestStatus.approved],
                },
              },
            },
            _sum: { countedWeight: true },
          });
          usedThisMonth = monthUsageAgg._sum.countedWeight
            ? Number(monthUsageAgg._sum.countedWeight)
            : 0;
        }

        return {
          leaveTypeId: b.leaveTypeId,
          leaveTypeName: b.leaveType.name,
          isWfh: b.leaveType.isWfh,
          year: b.year,
          allocated,
          used,
          pending,
          available,
          monthlyLimit:
            b.leaveType.monthlyLimit !== null
              ? Number(b.leaveType.monthlyLimit)
              : null,
          usedThisMonth,
        };
      }),
    );

    // B. Upcoming leaves next 30 days
    const next30Str = DateUtil.addDays(today, 30);
    const segments = await this.prisma.leaveSegment.findMany({
      where: {
        userId: caller.id,
        startDate: { lte: DateUtil.parse(next30Str) },
        endDate: { gte: DateUtil.parse(today) },
        request: {
          orgId: caller.orgId,
          status: RequestStatus.approved,
        },
      },
      include: {
        leaveType: {
          select: {
            id: true,
            name: true,
            isWfh: true,
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    const upcomingLeaves = segments.map((s) => {
      const segStart = DateUtil.format(s.startDate);
      const segEnd = DateUtil.format(s.endDate);
      const clippedStart = segStart < today ? today : segStart;
      const clippedEnd = segEnd > next30Str ? next30Str : segEnd;

      return {
        id: s.id,
        kind: s.leaveType.isWfh ? ('wfh' as const) : ('leave' as const),
        leaveTypeName: s.leaveType.name,
        startDate: clippedStart,
        endDate: clippedEnd,
        portion: s.portion,
      };
    });

    // C. Pending requests of caller
    const pendingReqs = await this.prisma.leaveRequest.findMany({
      where: {
        userId: caller.id,
        orgId: caller.orgId,
        status: RequestStatus.pending,
      },
      include: {
        segments: {
          include: {
            leaveType: {
              select: {
                id: true,
                name: true,
                isWfh: true,
              },
            },
          },
          orderBy: { startDate: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const pendingRequests = {
      count: pendingReqs.length,
      items: pendingReqs.map((r) => ({
        id: r.id,
        reason: r.reason,
        spanDays: r.spanDays,
        countedDays: r.countedDays,
        createdAt: r.createdAt,
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
      })),
    };

    return {
      balances: balanceItems,
      upcomingLeaves,
      pendingRequests,
      upcomingHolidays,
    };
  }

  /**
   * 2. GET /dashboard/team
   * Team overview for managers: today's counts and upcoming leaves for direct reports (next 7d).
   */
  async getTeamDashboard(caller: { id: string; orgId: string }) {
    const { today } = await this.getOrgToday(caller.orgId);

    const directReports = await this.prisma.user.findMany({
      where: {
        orgId: caller.orgId,
        managerId: caller.id,
        active: true,
      },
      select: {
        id: true,
        name: true,
        department: true,
      },
    });

    const directReportIds = directReports.map((u) => u.id);

    // Today's counts via shared availability service
    const todayRes = await this.availabilityService.buildToday(
      caller.orgId,
      directReportIds,
      today,
    );

    // Upcoming direct report leaves next 7 days
    const next7Str = DateUtil.addDays(today, 7);
    const segments = await this.prisma.leaveSegment.findMany({
      where: {
        userId: { in: directReportIds },
        startDate: { lte: DateUtil.parse(next7Str) },
        endDate: { gte: DateUtil.parse(today) },
        request: {
          orgId: caller.orgId,
          status: RequestStatus.approved,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            department: true,
          },
        },
        leaveType: {
          select: {
            isWfh: true,
          },
        },
        segmentDays: {
          where: {
            date: {
              gte: DateUtil.parse(today),
              lte: DateUtil.parse(next7Str),
            },
            skipReason: SkipReason.none,
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    // Privacy: Only member info, kind, clipped dates, and portion. NO reason or leave type name.
    // Exclude segments that fall strictly on off dates (no working leave days in range)
    const upcoming = segments
      .filter((s) => s.segmentDays.length > 0)
      .map((s) => {
        const segStart = DateUtil.format(s.startDate);
        const segEnd = DateUtil.format(s.endDate);
        const clippedStart = segStart < today ? today : segStart;
        const clippedEnd = segEnd > next7Str ? next7Str : segEnd;

        return {
          member: {
            id: s.user.id,
            name: s.user.name,
            department: s.user.department,
          },
          kind: s.leaveType.isWfh ? ('wfh' as const) : ('leave' as const),
          startDate: clippedStart,
          endDate: clippedEnd,
          portion: s.portion,
        };
      });

    return {
      today: todayRes.counts,
      upcoming,
    };
  }

  /**
   * 3. GET /dashboard/hr
   * HR Overview: pending approvals caller can decide, on-leave today, headcount,
   * this month's breakdown, requests in last 30d, and upcoming holidays.
   */
  async getHrDashboard(caller: { id: string; role: Role; orgId: string }) {
    const { today } = await this.getOrgToday(caller.orgId);

    // A. Pending approvals caller can decide
    // HR Admin can decide staff/manager requests; Org Owner can decide staff/manager/hr_admin requests
    const deciderRoles =
      caller.role === Role.hr_admin
        ? [Role.staff, Role.manager]
        : [Role.staff, Role.manager, Role.hr_admin];

    const pendingApprovalsCount = await this.prisma.leaveRequest.count({
      where: {
        orgId: caller.orgId,
        status: RequestStatus.pending,
        userId: { not: caller.id },
        user: {
          role: { in: deciderRoles },
          active: true,
        },
      },
    });

    // B. On-leave today count across org
    const todayDays = await this.prisma.leaveSegmentDay.findMany({
      where: {
        orgId: caller.orgId,
        date: DateUtil.parse(today),
        skipReason: SkipReason.none,
        request: { status: RequestStatus.approved },
        user: { active: true },
      },
      select: {
        userId: true,
        leaveType: { select: { isWfh: true } },
      },
    });

    const leaveUserIds = new Set<string>();
    const wfhUserIds = new Set<string>();
    for (const d of todayDays) {
      if (d.leaveType.isWfh) {
        wfhUserIds.add(d.userId);
      } else {
        leaveUserIds.add(d.userId);
      }
    }

    const onLeaveToday = {
      leave: leaveUserIds.size,
      wfh: wfhUserIds.size,
    };

    // C. Headcount: active staff + manager + hr_admin
    const headcount = await this.prisma.user.count({
      where: {
        orgId: caller.orgId,
        active: true,
        role: { in: [Role.staff, Role.manager, Role.hr_admin] },
      },
    });

    // D. This Month Breakdown
    const [yStr, mStr] = today.split('-');
    const startOfMonth = DateUtil.parse(`${yStr}-${mStr}-01`);
    const endOfMonth = new Date(
      Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10), 0),
    );

    const monthDays = await this.prisma.leaveSegmentDay.findMany({
      where: {
        orgId: caller.orgId,
        date: { gte: startOfMonth, lte: endOfMonth },
        skipReason: SkipReason.none,
        request: { status: RequestStatus.approved },
      },
      include: {
        leaveType: { select: { name: true } },
        user: { select: { department: true } },
      },
    });

    const byTypeMap = new Map<string, number>();
    const byDeptMap = new Map<string, number>();

    for (const d of monthDays) {
      const typeName = d.leaveType.name;
      byTypeMap.set(
        typeName,
        (byTypeMap.get(typeName) || 0) + Number(d.countedWeight),
      );

      const dept = d.user.department || 'Unassigned';
      byDeptMap.set(
        dept,
        (byDeptMap.get(dept) || 0) + Number(d.countedWeight),
      );
    }

    const byLeaveType = Array.from(byTypeMap.entries()).map(([name, days]) => ({
      name,
      days: Number(days.toFixed(1)),
    }));

    const byDepartment = Array.from(byDeptMap.entries()).map(
      ([department, days]) => ({
        department,
        days: Number(days.toFixed(1)),
      }),
    );

    // E. Requests in last 30 days
    const last30Date = DateUtil.parse(DateUtil.addDays(today, -30));
    const statusCounts = await this.prisma.leaveRequest.groupBy({
      by: ['status'],
      where: {
        orgId: caller.orgId,
        createdAt: { gte: last30Date },
      },
      _count: { id: true },
    });

    const requestsLast30Days = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const sc of statusCounts) {
      if (sc.status in requestsLast30Days) {
        (requestsLast30Days as any)[sc.status] = sc._count.id;
      }
    }

    // F. Upcoming holidays (next 3)
    const holidays = await this.prisma.holiday.findMany({
      where: {
        orgId: caller.orgId,
        active: true,
        date: { gte: DateUtil.parse(today) },
      },
      orderBy: { date: 'asc' },
      take: 3,
    });
    const upcomingHolidays = holidays.map((h) => ({
      id: h.id,
      name: h.name,
      date: DateUtil.format(h.date),
    }));

    return {
      pendingApprovalsCount,
      onLeaveToday,
      headcount,
      thisMonth: {
        byLeaveType,
        byDepartment,
      },
      requestsLast30Days,
      upcomingHolidays,
    };
  }

  /**
   * 4. GET /dashboard/owner
   * Org Owner Overview: All HR metrics + HR Admin pending approvals,
   * count of active HR Admins, and recent 10 audit logs.
   */
  async getOwnerDashboard(caller: { id: string; role: Role; orgId: string }) {
    const hrMetrics = await this.getHrDashboard(caller);

    // Pending requests submitted by HR Admins
    const pendingHrAdminApprovals = await this.prisma.leaveRequest.count({
      where: {
        orgId: caller.orgId,
        status: RequestStatus.pending,
        userId: { not: caller.id },
        user: {
          role: Role.hr_admin,
          active: true,
        },
      },
    });

    // Active HR Admins count
    const activeHrAdmins = await this.prisma.user.count({
      where: {
        orgId: caller.orgId,
        role: Role.hr_admin,
        active: true,
      },
    });

    // Recent 10 audit log entries
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { orgId: caller.orgId },
      include: {
        actor: { select: { name: true } },
        targetUser: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const recentAudit = auditLogs.map((l) => ({
      id: l.id,
      action: l.action,
      actorName: l.actor?.name ?? null,
      targetName: l.targetUser?.name ?? null,
      createdAt: l.createdAt,
    }));

    return {
      ...hrMetrics,
      pendingHrAdminApprovals,
      activeHrAdmins,
      recentAudit,
    };
  }
}
