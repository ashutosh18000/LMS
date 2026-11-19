import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, RequestStatus, SkipReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClockService } from '../common/services/clock.service';
import { LeaveYearService } from '../balances/leave-year.service';
import { DateUtil } from '../common/utils/date.util';
import { CsvColumn, CsvUtil } from '../common/utils/csv.util';
import { validateDateRange } from '../common/dto/date-range.dto';
import { QueryCalendarDto } from './dto/query-calendar.dto';
import { QueryOnLeaveDto } from './dto/query-on-leave.dto';
import { QueryBalanceSummaryDto } from './dto/query-balance-summary.dto';
import {
  QueryUtilizationDto,
  UtilizationGroupBy,
} from './dto/query-utilization.dto';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clockService: ClockService,
    private readonly leaveYearService: LeaveYearService,
  ) {}

  /**
   * 1. GET /reports/calendar
   * Org-wide calendar view of approved (and optionally pending) leave segments.
   */
  async getCalendarReport(callerOrgId: string, query: QueryCalendarDto) {
    validateDateRange(query.from, query.to, 92);

    const fromDate = DateUtil.parse(query.from);
    const toDate = DateUtil.parse(query.to);

    const statusCondition = query.includePending
      ? { in: [RequestStatus.approved, RequestStatus.pending] }
      : RequestStatus.approved;

    const where: Prisma.LeaveSegmentWhereInput = {
      request: {
        orgId: callerOrgId,
        status: statusCondition,
      },
      startDate: { lte: toDate },
      endDate: { gte: fromDate },
    };

    if (query.userId) {
      where.userId = query.userId;
    }
    if (query.department) {
      where.user = { department: query.department };
    }

    if (query.format === 'csv') {
      const segments = await this.prisma.leaveSegment.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, department: true } },
          leaveType: { select: { id: true, name: true, isWfh: true } },
          request: { select: { id: true, reason: true, status: true } },
        },
        orderBy: { startDate: 'asc' },
      });

      const rows = segments.map((s) => {
        const segStart = DateUtil.format(s.startDate);
        const segEnd = DateUtil.format(s.endDate);
        const clippedStart = segStart < query.from ? query.from : segStart;
        const clippedEnd = segEnd > query.to ? query.to : segEnd;

        return {
          userName: s.user.name,
          department: s.user.department ?? '',
          leaveTypeName: s.leaveType.name,
          isWfh: s.leaveType.isWfh ? 'Yes' : 'No',
          portion: s.portion,
          startDate: clippedStart,
          endDate: clippedEnd,
          reason: s.request.reason,
          status: s.request.status,
        };
      });

      const columns: CsvColumn[] = [
        { header: 'User Name', key: 'userName' },
        { header: 'Department', key: 'department' },
        { header: 'Leave Type', key: 'leaveTypeName' },
        { header: 'Is WFH', key: 'isWfh' },
        { header: 'Portion', key: 'portion' },
        { header: 'Start Date', key: 'startDate' },
        { header: 'End Date', key: 'endDate' },
        { header: 'Reason', key: 'reason' },
        { header: 'Status', key: 'status' },
      ];

      const csv = CsvUtil.generateCsv(columns, rows);
      return {
        isCsv: true,
        csv,
        filename: `calendar-report-${query.from}-to-${query.to}.csv`,
      };
    }

    // JSON Paginated
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [total, segments] = await Promise.all([
      this.prisma.leaveSegment.count({ where }),
      this.prisma.leaveSegment.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, department: true } },
          leaveType: { select: { id: true, name: true, isWfh: true } },
          request: { select: { id: true, reason: true, status: true } },
        },
        orderBy: { startDate: 'asc' },
        skip,
        take: limit,
      }),
    ]);

    const items = segments.map((s) => {
      const segStart = DateUtil.format(s.startDate);
      const segEnd = DateUtil.format(s.endDate);
      const clippedStart = segStart < query.from ? query.from : segStart;
      const clippedEnd = segEnd > query.to ? query.to : segEnd;

      return {
        id: s.id,
        userId: s.userId,
        userName: s.user.name,
        department: s.user.department,
        leaveTypeId: s.leaveTypeId,
        leaveTypeName: s.leaveType.name,
        isWfh: s.leaveType.isWfh,
        portion: s.portion,
        startDate: clippedStart,
        endDate: clippedEnd,
        reason: s.request.reason,
        status: s.request.status,
      };
    });

    return {
      isCsv: false,
      data: {
        items,
        total,
        page,
        limit,
      },
    };
  }

  /**
   * 2. GET /reports/on-leave
   * Returns employees on leave or WFH for a specified date (defaults to today).
   */
  async getOnLeaveReport(callerOrgId: string, query: QueryOnLeaveDto) {
    let dateStr = query.date;
    if (!dateStr) {
      const org = await this.prisma.organization.findUnique({
        where: { id: callerOrgId },
        select: { timezone: true },
      });
      dateStr = this.clockService.today(org?.timezone ?? 'UTC');
    }

    const targetDate = DateUtil.parse(dateStr);

    const days = await this.prisma.leaveSegmentDay.findMany({
      where: {
        orgId: callerOrgId,
        date: targetDate,
        skipReason: SkipReason.none,
        request: { status: RequestStatus.approved },
      },
      include: {
        user: { select: { id: true, name: true, department: true } },
        leaveType: { select: { id: true, name: true, isWfh: true } },
        segment: { select: { portion: true } },
      },
      orderBy: { user: { name: 'asc' } },
    });

    const items = days.map((d) => ({
      userId: d.user.id,
      userName: d.user.name,
      department: d.user.department,
      leaveTypeName: d.leaveType.name,
      isWfh: d.leaveType.isWfh,
      portion: d.segment.portion,
      status: d.leaveType.isWfh ? ('wfh' as const) : ('leave' as const),
    }));

    if (query.format === 'csv') {
      const columns: CsvColumn[] = [
        { header: 'User Name', key: 'userName' },
        { header: 'Department', key: 'department' },
        { header: 'Leave Type', key: 'leaveTypeName' },
        { header: 'Is WFH', value: (r) => (r.isWfh ? 'Yes' : 'No') },
        { header: 'Portion', key: 'portion' },
        { header: 'Status', key: 'status' },
      ];

      const csv = CsvUtil.generateCsv(columns, items);
      return {
        isCsv: true,
        csv,
        filename: `on-leave-report-${dateStr}.csv`,
      };
    }

    return {
      isCsv: false,
      data: {
        date: dateStr,
        items,
      },
    };
  }

  /**
   * 3. GET /reports/balance-summary
   * Aggregates employee leave balances by year with department/type totals.
   */
  async getBalanceSummaryReport(
    callerOrgId: string,
    query: QueryBalanceSummaryDto,
  ) {
    let year = query.year;
    if (!year) {
      const org = await this.prisma.organization.findUnique({
        where: { id: callerOrgId },
        select: { timezone: true, financialYearStartMonth: true },
      });
      const today = this.clockService.today(org?.timezone ?? 'UTC');
      year = this.leaveYearService.leaveYearOf(
        today,
        org?.financialYearStartMonth ?? 4,
      );
    }

    const where: Prisma.LeaveBalanceWhereInput = {
      orgId: callerOrgId,
      year,
      user: { active: true },
    };

    if (query.leaveTypeId) {
      where.leaveTypeId = query.leaveTypeId;
    }
    if (query.department) {
      where.user = { active: true, department: query.department };
    }

    const count = await this.prisma.leaveBalance.count({ where });
    if (count > 5000) {
      throw new BadRequestException(
        'Too many rows (>5000). Please apply department or leaveTypeId filter.',
      );
    }

    const balances = await this.prisma.leaveBalance.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, department: true } },
        leaveType: { select: { id: true, name: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { leaveType: { name: 'asc' } }],
    });

    const rows = balances.map((b) => {
      const allocated = Number(b.allocated);
      const used = Number(b.used);
      const pending = Number(b.pending);
      const available = Number((allocated - used - pending).toFixed(1));

      return {
        userId: b.user.id,
        userName: b.user.name,
        department: b.user.department,
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        year: b.year,
        allocated,
        used,
        pending,
        available,
      };
    });

    // Totals by department & by leave type
    const deptMap = new Map<
      string,
      { allocated: number; used: number; pending: number; available: number }
    >();
    const typeMap = new Map<
      string,
      {
        leaveTypeId: string;
        leaveTypeName: string;
        allocated: number;
        used: number;
        pending: number;
        available: number;
      }
    >();

    for (const r of rows) {
      const deptKey = r.department || 'Unassigned';
      const deptStat = deptMap.get(deptKey) || {
        allocated: 0,
        used: 0,
        pending: 0,
        available: 0,
      };
      deptStat.allocated += r.allocated;
      deptStat.used += r.used;
      deptStat.pending += r.pending;
      deptStat.available += r.available;
      deptMap.set(deptKey, deptStat);

      const typeStat = typeMap.get(r.leaveTypeId) || {
        leaveTypeId: r.leaveTypeId,
        leaveTypeName: r.leaveTypeName,
        allocated: 0,
        used: 0,
        pending: 0,
        available: 0,
      };
      typeStat.allocated += r.allocated;
      typeStat.used += r.used;
      typeStat.pending += r.pending;
      typeStat.available += r.available;
      typeMap.set(r.leaveTypeId, typeStat);
    }

    const totals = {
      byDepartment: Array.from(deptMap.entries()).map(([department, s]) => ({
        department,
        allocated: Number(s.allocated.toFixed(1)),
        used: Number(s.used.toFixed(1)),
        pending: Number(s.pending.toFixed(1)),
        available: Number(s.available.toFixed(1)),
      })),
      byLeaveType: Array.from(typeMap.values()).map((s) => ({
        leaveTypeId: s.leaveTypeId,
        leaveTypeName: s.leaveTypeName,
        allocated: Number(s.allocated.toFixed(1)),
        used: Number(s.used.toFixed(1)),
        pending: Number(s.pending.toFixed(1)),
        available: Number(s.available.toFixed(1)),
      })),
    };

    if (query.format === 'csv') {
      const columns: CsvColumn[] = [
        { header: 'User Name', key: 'userName' },
        { header: 'Department', value: (r) => r.department ?? '' },
        { header: 'Leave Type', key: 'leaveTypeName' },
        { header: 'Year', key: 'year' },
        { header: 'Allocated', key: 'allocated' },
        { header: 'Used', key: 'used' },
        { header: 'Pending', key: 'pending' },
        { header: 'Available', key: 'available' },
      ];

      const csv = CsvUtil.generateCsv(columns, rows);
      return {
        isCsv: true,
        csv,
        filename: `balance-summary-report-${year}.csv`,
      };
    }

    return {
      isCsv: false,
      data: {
        year,
        rows,
        totals,
      },
    };
  }

  /**
   * 4. GET /reports/utilization
   * Reports approved leave utilization grouped by department, leave type, or user.
   */
  async getUtilizationReport(callerOrgId: string, query: QueryUtilizationDto) {
    validateDateRange(query.from, query.to, 92);

    const fromDate = DateUtil.parse(query.from);
    const toDate = DateUtil.parse(query.to);

    const segmentDays = await this.prisma.leaveSegmentDay.findMany({
      where: {
        orgId: callerOrgId,
        date: { gte: fromDate, lte: toDate },
        skipReason: SkipReason.none,
        request: { status: RequestStatus.approved },
      },
      include: {
        user: { select: { id: true, name: true, department: true } },
        leaveType: { select: { id: true, name: true, isWfh: true } },
      },
    });

    if (query.groupBy === UtilizationGroupBy.department) {
      // Group by department with headcount & per-employee average
      const activeUsers = await this.prisma.user.findMany({
        where: { orgId: callerOrgId, active: true },
        select: { id: true, department: true },
      });

      const headcountByDept = new Map<string, number>();
      for (const u of activeUsers) {
        const d = u.department || 'Unassigned';
        headcountByDept.set(d, (headcountByDept.get(d) || 0) + 1);
      }

      const daysByDept = new Map<string, number>();
      for (const d of segmentDays) {
        const dept = d.user.department || 'Unassigned';
        daysByDept.set(
          dept,
          (daysByDept.get(dept) || 0) + Number(d.countedWeight),
        );
      }

      const allDepts = Array.from(
        new Set([...headcountByDept.keys(), ...daysByDept.keys()]),
      ).sort();

      const items = allDepts.map((department) => {
        const days = Number((daysByDept.get(department) || 0).toFixed(1));
        const headcount = headcountByDept.get(department) || 0;
        const perEmployeeAverage =
          headcount > 0 ? Number((days / headcount).toFixed(2)) : 0;

        return {
          department,
          days,
          headcount,
          perEmployeeAverage,
        };
      });

      if (query.format === 'csv') {
        const columns: CsvColumn[] = [
          { header: 'Department', key: 'department' },
          { header: 'Days', key: 'days' },
          { header: 'Headcount', key: 'headcount' },
          { header: 'Per-Employee Average', key: 'perEmployeeAverage' },
        ];
        const csv = CsvUtil.generateCsv(columns, items);
        return {
          isCsv: true,
          csv,
          filename: `utilization-by-department-${query.from}-to-${query.to}.csv`,
        };
      }

      return {
        isCsv: false,
        data: {
          from: query.from,
          to: query.to,
          groupBy: query.groupBy,
          items,
        },
      };
    }

    if (query.groupBy === UtilizationGroupBy.leaveType) {
      const typeMap = new Map<
        string,
        {
          leaveTypeId: string;
          leaveTypeName: string;
          isWfh: boolean;
          days: number;
        }
      >();

      for (const d of segmentDays) {
        const existing = typeMap.get(d.leaveTypeId) || {
          leaveTypeId: d.leaveTypeId,
          leaveTypeName: d.leaveType.name,
          isWfh: d.leaveType.isWfh,
          days: 0,
        };
        existing.days += Number(d.countedWeight);
        typeMap.set(d.leaveTypeId, existing);
      }

      const items = Array.from(typeMap.values()).map((t) => ({
        ...t,
        days: Number(t.days.toFixed(1)),
      }));

      if (query.format === 'csv') {
        const columns: CsvColumn[] = [
          { header: 'Leave Type', key: 'leaveTypeName' },
          { header: 'Is WFH', value: (r) => (r.isWfh ? 'Yes' : 'No') },
          { header: 'Days', key: 'days' },
        ];
        const csv = CsvUtil.generateCsv(columns, items);
        return {
          isCsv: true,
          csv,
          filename: `utilization-by-leaveType-${query.from}-to-${query.to}.csv`,
        };
      }

      return {
        isCsv: false,
        data: {
          from: query.from,
          to: query.to,
          groupBy: query.groupBy,
          items,
        },
      };
    }

    // groupBy === UtilizationGroupBy.user
    const userMap = new Map<
      string,
      {
        userId: string;
        userName: string;
        department: string | null;
        days: number;
      }
    >();

    for (const d of segmentDays) {
      const existing = userMap.get(d.userId) || {
        userId: d.userId,
        userName: d.user.name,
        department: d.user.department,
        days: 0,
      };
      existing.days += Number(d.countedWeight);
      userMap.set(d.userId, existing);
    }

    const items = Array.from(userMap.values()).map((u) => ({
      ...u,
      days: Number(u.days.toFixed(1)),
    }));

    if (query.format === 'csv') {
      const columns: CsvColumn[] = [
        { header: 'User Name', key: 'userName' },
        { header: 'Department', value: (r) => r.department ?? '' },
        { header: 'Days', key: 'days' },
      ];
      const csv = CsvUtil.generateCsv(columns, items);
      return {
        isCsv: true,
        csv,
        filename: `utilization-by-user-${query.from}-to-${query.to}.csv`,
      };
    }

    return {
      isCsv: false,
      data: {
        from: query.from,
        to: query.to,
        groupBy: query.groupBy,
        items,
      },
    };
  }
}
