import { Injectable } from '@nestjs/common';
import { Portion, RequestStatus, SegmentStatus, SkipReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleResolverService } from '../../schedules/schedule-resolver.service';
import { DateUtil } from '../utils/date.util';

export interface AvailabilitySegment {
  kind: 'leave' | 'wfh';
  startDate: string;
  endDate: string;
  portion: Portion;
}

export interface MemberAvailability {
  userId: string;
  name: string;
  department: string | null;
  offDates: string[];
  halfDates: string[];
  segments: AvailabilitySegment[];
}

export interface RangeAvailabilityResponse {
  holidays: Array<{ date: string; name: string }>;
  members: MemberAvailability[];
}

export interface MemberTodayStatus {
  userId: string;
  name: string;
  department: string | null;
  status: 'off' | 'leave' | 'wfh' | 'available';
  portion?: Portion;
  halfDay?: boolean;
}

export interface TodayAvailability {
  date: string;
  dayInfo: {
    isHoliday: boolean;
    holidayName?: string;
  };
  counts: {
    onLeave: number;
    wfh: number;
    available: number;
    off: number;
    total: number;
  };
  members: MemberTodayStatus[];
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleResolverService: ScheduleResolverService,
  ) {}

  /**
   * Builds team availability over a date range.
   * Includes active holidays for the range, each member's offDates and halfDates
   * calculated from their specific work schedule, and clipped approved leave segments.
   * Strict privacy: Only allowed keys are returned (no schedule rules, reasons, balances, etc.).
   */
  async buildAvailability(
    orgId: string,
    memberIds: string[],
    from: string,
    to: string,
  ): Promise<RangeAvailabilityResponse> {
    const fromDate = DateUtil.parse(from);
    const toDate = DateUtil.parse(to);
    const dates = DateUtil.iterate(from, to);

    // 1. Fetch active holidays in range (single query)
    const holidays = await this.prisma.holiday.findMany({
      where: {
        orgId,
        active: true,
        date: { gte: fromDate, lte: toDate },
      },
      select: { date: true, name: true },
      orderBy: { date: 'asc' },
    });

    const holidayList = holidays.map((h) => ({
      date: DateUtil.format(h.date),
      name: h.name,
    }));
    const holidayDateSet = new Set(holidayList.map((h) => h.date));

    if (!memberIds || memberIds.length === 0) {
      return {
        holidays: holidayList,
        members: [],
      };
    }

    const uniqueIds = Array.from(new Set(memberIds));

    // 2. Fetch active members in caller's organization
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        orgId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        department: true,
      },
      orderBy: { name: 'asc' },
    });

    if (users.length === 0) {
      return {
        holidays: holidayList,
        members: [],
      };
    }

    const activeUserIds = users.map((u) => u.id);

    // 3. Batch resolve work schedules for all active users across the range (single query)
    const scheduleMap = await this.scheduleResolverService.resolveRangeForUsers(
      orgId,
      activeUserIds,
      from,
      to,
    );

    // 4. Query approved leave segments overlapping [from, to]
    const segments = await this.prisma.leaveSegment.findMany({
      where: {
        userId: { in: activeUserIds },
        startDate: { lte: toDate },
        endDate: { gte: fromDate },
        status: SegmentStatus.approved,
        request: {
          orgId,
          status: { in: [RequestStatus.approved, RequestStatus.partially_approved] },
        },
      },
      select: {
        userId: true,
        startDate: true,
        endDate: true,
        portion: true,
        leaveType: {
          select: {
            isWfh: true,
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });

    // 5. Group and clip segments per user
    const segmentsByUser = new Map<string, AvailabilitySegment[]>();
    for (const seg of segments) {
      const segStart = DateUtil.format(seg.startDate);
      const segEnd = DateUtil.format(seg.endDate);

      const clippedStart = segStart < from ? from : segStart;
      const clippedEnd = segEnd > to ? to : segEnd;
      const kind: 'leave' | 'wfh' = seg.leaveType.isWfh ? 'wfh' : 'leave';

      const list = segmentsByUser.get(seg.userId) || [];
      list.push({
        kind,
        startDate: clippedStart,
        endDate: clippedEnd,
        portion: seg.portion,
      });
      segmentsByUser.set(seg.userId, list);
    }

    // 6. Map active members with offDates, halfDates, and segments
    const members: MemberAvailability[] = users.map((u) => {
      const userSchedule = scheduleMap.get(u.id);
      const offDates: string[] = [];
      const halfDates: string[] = [];

      for (const d of dates) {
        const isHoli = holidayDateSet.has(d);
        const daySched = userSchedule?.get(d);
        const isWeeklyOff = daySched?.weeklyOff ?? true;
        const weight = daySched?.weight ?? 0;

        if (isHoli || isWeeklyOff) {
          offDates.push(d);
        } else if (weight === 0.5) {
          halfDates.push(d);
        }
      }

      offDates.sort();
      halfDates.sort();

      return {
        userId: u.id,
        name: u.name,
        department: u.department,
        offDates,
        halfDates,
        segments: segmentsByUser.get(u.id) || [],
      };
    });

    return {
      holidays: holidayList,
      members,
    };
  }

  /**
   * Builds team availability status for a single day.
   * Considers employee work schedule (weekly off, Saturday mode), org holidays,
   * and approved leave/WFH on working days.
   */
  async buildToday(
    orgId: string,
    memberIds: string[],
    date: string,
  ): Promise<TodayAvailability> {
    const targetDate = DateUtil.parse(date);

    // 1. Check if today is an active organization holiday
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        orgId,
        active: true,
        date: targetDate,
      },
      select: { name: true },
    });

    const dayInfo = {
      isHoliday: !!holiday,
      holidayName: holiday?.name ?? undefined,
    };

    if (!memberIds || memberIds.length === 0) {
      return {
        date,
        dayInfo,
        counts: { onLeave: 0, wfh: 0, available: 0, off: 0, total: 0 },
        members: [],
      };
    }

    const uniqueIds = Array.from(new Set(memberIds));

    // 2. Fetch active members in caller's organization
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        orgId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        department: true,
      },
      orderBy: { name: 'asc' },
    });

    if (users.length === 0) {
      return {
        date,
        dayInfo,
        counts: { onLeave: 0, wfh: 0, available: 0, off: 0, total: 0 },
        members: [],
      };
    }

    const activeUserIds = users.map((u) => u.id);

    // 3. Batch resolve work schedules for today (single query)
    const scheduleMap = await this.scheduleResolverService.resolveRangeForUsers(
      orgId,
      activeUserIds,
      date,
      date,
    );

    // 4. Query approved LeaveSegmentDay records for target date
    const segmentDays = await this.prisma.leaveSegmentDay.findMany({
      where: {
        userId: { in: activeUserIds },
        orgId,
        date: targetDate,
        occupancy: { gt: 0 },
        segment: {
          status: SegmentStatus.approved,
        },
        request: {
          status: { in: [RequestStatus.approved, RequestStatus.partially_approved] },
        },
      },
      select: {
        userId: true,
        skipReason: true,
        leaveType: {
          select: {
            isWfh: true,
          },
        },
        segment: {
          select: {
            portion: true,
          },
        },
      },
    });

    // 5. Group working leave days (only skipReason === none)
    const userWorkingLeave = new Map<
      string,
      { kind: 'leave' | 'wfh'; portion: Portion }
    >();

    for (const day of segmentDays) {
      if (day.skipReason === SkipReason.none) {
        const existing = userWorkingLeave.get(day.userId);
        const kind: 'leave' | 'wfh' = day.leaveType.isWfh ? 'wfh' : 'leave';

        if (!existing) {
          userWorkingLeave.set(day.userId, {
            kind,
            portion: day.segment.portion,
          });
        } else if (existing.kind === 'wfh' && kind === 'leave') {
          // Leave takes precedence over WFH if user has both on the same date
          userWorkingLeave.set(day.userId, {
            kind: 'leave',
            portion: day.segment.portion,
          });
        }
      }
    }

    // 6. Compute status and counts per member
    let onLeaveCount = 0;
    let wfhCount = 0;
    let availableCount = 0;
    let offCount = 0;

    const members: MemberTodayStatus[] = users.map((u) => {
      const userSchedule = scheduleMap.get(u.id)?.get(date);
      const weeklyOff = userSchedule?.weeklyOff ?? true;
      const weight = userSchedule?.weight ?? 0;

      // Rule 1: Off check first (org holiday OR member's weekly off)
      // Even if an approved leave exists with skipReason != none, status is "off"
      if (dayInfo.isHoliday || weeklyOff) {
        offCount++;
        return {
          userId: u.id,
          name: u.name,
          department: u.department,
          status: 'off' as const,
        };
      }

      // Rule 2: Working day with approved leave or WFH
      const leaveInfo = userWorkingLeave.get(u.id);
      if (leaveInfo) {
        if (leaveInfo.kind === 'leave') {
          onLeaveCount++;
        } else {
          wfhCount++;
        }
        return {
          userId: u.id,
          name: u.name,
          department: u.department,
          status: leaveInfo.kind,
          portion: leaveInfo.portion,
        };
      }

      // Rule 3: Available (working day with no leave)
      availableCount++;
      const memberStatus: MemberTodayStatus = {
        userId: u.id,
        name: u.name,
        department: u.department,
        status: 'available',
      };

      // Saturday half-day or 0.5 weight day
      if (weight === 0.5) {
        memberStatus.halfDay = true;
      }

      return memberStatus;
    });

    return {
      date,
      dayInfo,
      counts: {
        onLeave: onLeaveCount,
        wfh: wfhCount,
        available: availableCount,
        off: offCount,
        total: users.length,
      },
      members,
    };
  }
}
