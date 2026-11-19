import { Injectable } from '@nestjs/common';
import { Portion, RequestStatus, SkipReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
  segments: AvailabilitySegment[];
}

export interface MemberTodayStatus {
  userId: string;
  name: string;
  department: string | null;
  status: 'leave' | 'wfh' | 'available';
  portion?: Portion;
}

export interface TodayAvailability {
  date: string;
  counts: {
    onLeave: number;
    wfh: number;
    available: number;
    total: number;
  };
  members: MemberTodayStatus[];
}

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds team availability over a date range.
   * Only approved segments are included, clipped to [from, to].
   * Strict privacy: Only kind ('leave' | 'wfh'), startDate, endDate, and portion are exposed.
   */
  async buildAvailability(
    orgId: string,
    memberIds: string[],
    from: string,
    to: string,
  ): Promise<MemberAvailability[]> {
    if (!memberIds || memberIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(memberIds));

    // 1. Fetch active members in caller's organization
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
      return [];
    }

    const activeUserIds = users.map((u) => u.id);
    const fromDate = DateUtil.parse(from);
    const toDate = DateUtil.parse(to);

    // 2. Query approved leave segments overlapping [from, to]
    const segments = await this.prisma.leaveSegment.findMany({
      where: {
        userId: { in: activeUserIds },
        startDate: { lte: toDate },
        endDate: { gte: fromDate },
        request: {
          orgId,
          status: RequestStatus.approved,
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

    // 3. Group and clip segments per user
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

    // 4. Map active members (including those with empty segments)
    return users.map((u) => ({
      userId: u.id,
      name: u.name,
      department: u.department,
      segments: segmentsByUser.get(u.id) || [],
    }));
  }

  /**
   * Builds team availability status for a single day.
   * Derived from LeaveSegmentDay rows where skipReason = none.
   */
  async buildToday(
    orgId: string,
    memberIds: string[],
    date: string,
  ): Promise<TodayAvailability> {
    if (!memberIds || memberIds.length === 0) {
      return {
        date,
        counts: { onLeave: 0, wfh: 0, available: 0, total: 0 },
        members: [],
      };
    }

    const uniqueIds = Array.from(new Set(memberIds));

    // 1. Fetch active members in caller's organization
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
        counts: { onLeave: 0, wfh: 0, available: 0, total: 0 },
        members: [],
      };
    }

    const activeUserIds = users.map((u) => u.id);
    const targetDate = DateUtil.parse(date);

    // 2. Query approved LeaveSegmentDay records for target date where skipReason = none
    const segmentDays = await this.prisma.leaveSegmentDay.findMany({
      where: {
        userId: { in: activeUserIds },
        orgId,
        date: targetDate,
        skipReason: SkipReason.none,
        request: {
          status: RequestStatus.approved,
        },
      },
      select: {
        userId: true,
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

    // 3. Map primary status per user (leave takes precedence if both exist, counted once)
    const userStatusMap = new Map<
      string,
      { status: 'leave' | 'wfh'; portion: Portion }
    >();

    for (const day of segmentDays) {
      const existing = userStatusMap.get(day.userId);
      const dayStatus: 'leave' | 'wfh' = day.leaveType.isWfh ? 'wfh' : 'leave';

      if (!existing) {
        userStatusMap.set(day.userId, {
          status: dayStatus,
          portion: day.segment.portion,
        });
      } else if (existing.status === 'wfh' && dayStatus === 'leave') {
        // Upgrade from WFH to leave if member has both on the same date
        userStatusMap.set(day.userId, {
          status: 'leave',
          portion: day.segment.portion,
        });
      }
    }

    let onLeaveCount = 0;
    let wfhCount = 0;

    const members: MemberTodayStatus[] = users.map((u) => {
      const info = userStatusMap.get(u.id);
      if (info) {
        if (info.status === 'leave') {
          onLeaveCount++;
        } else {
          wfhCount++;
        }
        return {
          userId: u.id,
          name: u.name,
          department: u.department,
          status: info.status,
          portion: info.portion,
        };
      }
      return {
        userId: u.id,
        name: u.name,
        department: u.department,
        status: 'available',
      };
    });

    const total = users.length;
    const availableCount = total - onLeaveCount - wfhCount;

    return {
      date,
      counts: {
        onLeave: onLeaveCount,
        wfh: wfhCount,
        available: availableCount,
        total,
      },
      members,
    };
  }
}
