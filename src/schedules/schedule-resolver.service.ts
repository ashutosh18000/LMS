import { Injectable } from '@nestjs/common';
import { Prisma, SaturdayMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DateUtil } from '../common/utils/date.util';

export interface DayResolution {
  isWorkDay: boolean;
  weight: number;
  reason?: string;
  weeklyOff?: boolean;
}

@Injectable()
export class ScheduleResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves whether a given date is a working day, weekly off, or half day for an employee.
   * Treats the date strictly as a calendar date to prevent timezone displacement.
   */
  async resolveDay(
    userId: string,
    date: Date | string,
  ): Promise<DayResolution> {
    let dayOfMonth: number;
    let dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    let targetDate: Date;

    if (typeof date === 'string') {
      const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        dayOfMonth = parseInt(match[3], 10);
        targetDate = new Date(Date.UTC(year, month - 1, dayOfMonth));
        dayOfWeek = targetDate.getUTCDay();
      } else {
        const parsed = new Date(date);
        const year = parsed.getUTCFullYear();
        const month = parsed.getUTCMonth();
        dayOfMonth = parsed.getUTCDate();
        targetDate = new Date(Date.UTC(year, month, dayOfMonth));
        dayOfWeek = targetDate.getUTCDay();
      }
    } else {
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      dayOfMonth = date.getUTCDate();
      targetDate = new Date(Date.UTC(year, month, dayOfMonth));
      dayOfWeek = targetDate.getUTCDay();
    }

    // 1. Sunday is always off in v1 (weight 0)
    if (dayOfWeek === 0) {
      return {
        isWorkDay: false,
        weight: 0,
        reason: 'Sunday off',
        weeklyOff: true,
      };
    }

    // 2. Find the most recent EmployeeSchedule effective on or before targetDate
    const schedule = await this.prisma.employeeSchedule.findFirst({
      where: {
        userId,
        effectiveFrom: { lte: targetDate },
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { template: true },
    });

    // 3. If an explicit schedule template is assigned, resolve using template rules
    if (schedule?.template) {
      const template = schedule.template;

      // Regular weekdays (Monday - Friday) are standard full working days
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        return {
          isWorkDay: true,
          weight: 1,
          reason: 'Regular workday',
          weeklyOff: false,
        };
      }

      // Saturday (dayOfWeek === 6) logic
      if (dayOfWeek === 6) {
        switch (template.saturdayMode) {
          case SaturdayMode.off:
            return {
              isWorkDay: false,
              weight: 0,
              reason: 'Saturday off',
              weeklyOff: true,
            };
          case SaturdayMode.half:
            return {
              isWorkDay: true,
              weight: 0.5,
              reason: 'Saturday half day',
              weeklyOff: false,
            };
          case SaturdayMode.full:
            return {
              isWorkDay: true,
              weight: 1,
              reason: 'Saturday full day',
              weeklyOff: false,
            };
          case SaturdayMode.alternate: {
            // Saturday week number in month: ceil(dayOfMonth / 7)
            const weekNumber = Math.ceil(dayOfMonth / 7);
            const isOff = template.alternateOffWeeks.includes(weekNumber);
            return isOff
              ? {
                  isWorkDay: false,
                  weight: 0,
                  reason: `Alternate Saturday (${weekNumber}) off`,
                  weeklyOff: true,
                }
              : {
                  isWorkDay: true,
                  weight: 1,
                  reason: `Alternate Saturday (${weekNumber}) working`,
                  weeklyOff: false,
                };
          }
        }
      }
    }

    // 4. Fallback when no schedule is assigned: use Organization.workingDays
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    const workingDays = user?.organization?.workingDays ?? [1, 2, 3, 4, 5];
    const isWorking = workingDays.includes(dayOfWeek);

    if (isWorking) {
      return {
        isWorkDay: true,
        weight: 1,
        reason: 'Regular workday',
        weeklyOff: false,
      };
    }

    return {
      isWorkDay: false,
      weight: 0,
      reason: 'Weekly off',
      weeklyOff: true,
    };
  }

  /**
   * Resolves an entire date range for an employee in a single query.
   * Fetches employee schedule history on or before endDate, and returns
   * a Map of date strings ("YYYY-MM-DD") to { weeklyOff: boolean, weight: number }.
   */
  async resolveRange(
    userId: string,
    startDate: Date | string,
    endDate: Date | string,
    client?: PrismaService | Prisma.TransactionClient,
    knownWorkingDays?: number[],
  ): Promise<Map<string, { weeklyOff: boolean; weight: number }>> {
    const db = (client as any) ?? this.prisma;
    const startStr =
      typeof startDate === 'string'
        ? startDate.substring(0, 10)
        : DateUtil.format(startDate);
    const endStr =
      typeof endDate === 'string'
        ? endDate.substring(0, 10)
        : DateUtil.format(endDate);
    const endDateObj = DateUtil.parse(endStr);

    // Single query for user's schedule history up to endDate
    const schedules = await db.employeeSchedule.findMany({
      where: {
        userId,
        effectiveFrom: { lte: endDateObj },
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { template: true },
    });

    let fallbackWorkingDays: number[] | null = knownWorkingDays ?? null;
    const result = new Map<string, { weeklyOff: boolean; weight: number }>();
    const dates = DateUtil.iterate(startStr, endStr);

    for (const dateStr of dates) {
      const dateObj = DateUtil.parse(dateStr);
      const dayOfWeek = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
      const dayOfMonth = dateObj.getUTCDate();

      // 1. Sunday is always off in v1 (weight 0)
      if (dayOfWeek === 0) {
        result.set(dateStr, { weeklyOff: true, weight: 0 });
        continue;
      }

      // 2. Find schedule effective on or before this date (schedules is ordered desc by effectiveFrom)
      const schedule = (schedules as any[]).find((s) => s.effectiveFrom <= dateObj);

      if (schedule?.template) {
        const template = schedule.template;

        // Weekdays Monday-Friday
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          result.set(dateStr, { weeklyOff: false, weight: 1 });
          continue;
        }

        // Saturday
        if (dayOfWeek === 6) {
          switch (template.saturdayMode) {
            case SaturdayMode.off:
              result.set(dateStr, { weeklyOff: true, weight: 0 });
              break;
            case SaturdayMode.half:
              result.set(dateStr, { weeklyOff: false, weight: 0.5 });
              break;
            case SaturdayMode.full:
              result.set(dateStr, { weeklyOff: false, weight: 1 });
              break;
            case SaturdayMode.alternate: {
              const weekNumber = Math.ceil(dayOfMonth / 7);
              const isOff = template.alternateOffWeeks.includes(weekNumber);
              result.set(dateStr, {
                weeklyOff: isOff,
                weight: isOff ? 0 : 1,
              });
              break;
            }
          }
          continue;
        }
      }

      // 3. Fallback when no schedule is active: organization workingDays
      if (!fallbackWorkingDays) {
        const user = await db.user.findUnique({
          where: { id: userId },
          include: { organization: true },
        });
        fallbackWorkingDays = user?.organization?.workingDays ?? [1, 2, 3, 4, 5];
      }

      const activeWorkingDays = fallbackWorkingDays ?? [1, 2, 3, 4, 5];
      const isWorking = activeWorkingDays.includes(dayOfWeek);
      result.set(dateStr, {
        weeklyOff: !isWorking,
        weight: isWorking ? 1 : 0,
      });
    }

    return result;
  }

  /**
   * Batch resolves date ranges for multiple users in an organization in a single query.
   * Avoids N+1 queries by fetching all employee schedules and templates in one call.
   * Returns a Map of userId -> Map<dateStr, { weeklyOff, weight }>.
   */
  async resolveRangeForUsers(
    orgId: string,
    userIds: string[],
    from: Date | string,
    to: Date | string,
    client?: PrismaService | Prisma.TransactionClient,
  ): Promise<Map<string, Map<string, { weeklyOff: boolean; weight: number }>>> {
    const db = (client as any) ?? this.prisma;
    const startStr =
      typeof from === 'string'
        ? from.substring(0, 10)
        : DateUtil.format(from);
    const endStr =
      typeof to === 'string'
        ? to.substring(0, 10)
        : DateUtil.format(to);
    const endDateObj = DateUtil.parse(endStr);
    const dates = DateUtil.iterate(startStr, endStr);

    const resultMap = new Map<
      string,
      Map<string, { weeklyOff: boolean; weight: number }>
    >();

    if (!userIds || userIds.length === 0) {
      return resultMap;
    }

    const uniqueUserIds = Array.from(new Set(userIds));

    // 1. Fetch organization default working days (single query)
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { workingDays: true },
    });
    const defaultWorkingDays: number[] = org?.workingDays ?? [1, 2, 3, 4, 5];

    // 2. Fetch all employee schedules effective on or before endDate for all users (single query)
    const schedules = await db.employeeSchedule.findMany({
      where: {
        userId: { in: uniqueUserIds },
        effectiveFrom: { lte: endDateObj },
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { template: true },
    });

    // 3. Group schedules by userId
    const schedulesByUserId = new Map<string, typeof schedules>();
    for (const s of schedules) {
      const list = schedulesByUserId.get(s.userId) || [];
      list.push(s);
      schedulesByUserId.set(s.userId, list);
    }

    // 4. Resolve each user's schedule per date in range
    for (const uId of uniqueUserIds) {
      const userSchedules = schedulesByUserId.get(uId) || [];
      const userDateMap = new Map<
        string,
        { weeklyOff: boolean; weight: number }
      >();

      for (const dateStr of dates) {
        const dateObj = DateUtil.parse(dateStr);
        const dayOfWeek = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
        const dayOfMonth = dateObj.getUTCDate();

        // Sunday is always off (weight 0)
        if (dayOfWeek === 0) {
          userDateMap.set(dateStr, { weeklyOff: true, weight: 0 });
          continue;
        }

        // Find active schedule effective on or before dateObj (ordered desc by effectiveFrom)
        const schedule = userSchedules.find(
          (s: any) => s.effectiveFrom <= dateObj,
        );

        if (schedule?.template) {
          const template = schedule.template;

          // Monday - Friday: regular full working day
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            userDateMap.set(dateStr, { weeklyOff: false, weight: 1 });
            continue;
          }

          // Saturday (dayOfWeek === 6)
          if (dayOfWeek === 6) {
            switch (template.saturdayMode) {
              case SaturdayMode.off:
                userDateMap.set(dateStr, { weeklyOff: true, weight: 0 });
                break;
              case SaturdayMode.half:
                userDateMap.set(dateStr, { weeklyOff: false, weight: 0.5 });
                break;
              case SaturdayMode.full:
                userDateMap.set(dateStr, { weeklyOff: false, weight: 1 });
                break;
              case SaturdayMode.alternate: {
                const weekNumber = Math.ceil(dayOfMonth / 7);
                const isOff = template.alternateOffWeeks.includes(weekNumber);
                userDateMap.set(dateStr, {
                  weeklyOff: isOff,
                  weight: isOff ? 0 : 1,
                });
                break;
              }
            }
            continue;
          }
        }

        // Fallback: organization workingDays
        const isWorking = defaultWorkingDays.includes(dayOfWeek);
        userDateMap.set(dateStr, {
          weeklyOff: !isWorking,
          weight: isWorking ? 1 : 0,
        });
      }

      resultMap.set(uId, userDateMap);
    }

    return resultMap;
  }
}
