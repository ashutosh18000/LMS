import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  LeaveType,
  Portion,
  Prisma,
  RequestStatus,
  Role,
  SegmentStatus,
  SkipReason,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleResolverService } from '../schedules/schedule-resolver.service';
import { BalancesService } from '../balances/balances.service';
import { LeaveYearService } from '../balances/leave-year.service';
import { ClockService } from '../common/services/clock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DateUtil } from '../common/utils/date.util';
import { LeaveRequestException } from './exceptions/leave-request.exception';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { CreateLeaveSegmentDto } from './dto/create-leave-segment.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { CreateOnBehalfDto } from './dto/create-on-behalf.dto';
import { CancelApprovedLeaveDto } from './dto/cancel-approved.dto';
import { QueryAllRequestsDto } from './dto/query-all-requests.dto';
import { PaginatedResult } from '../common/dto/pagination.dto';
import { canDecide } from '../common/utils/decision-permission.util';
import { AuditAction, AuditService } from '../audit/audit.service';

interface SegmentDayCalculation {
  date: string;
  leaveTypeId: string;
  portion: Portion;
  occupancy: number;
  countedWeight: number;
  skipReason: SkipReason;
}

interface ProcessedSegment {
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  portion: Portion;
  countedDays: number;
  days: SegmentDayCalculation[];
}

interface NewDayEntry {
  portion: Portion;
  occupancy: number;
}

interface PreparedRequest {
  leaveTypes: LeaveType[];
  processedSegments: ProcessedSegment[];
  newDaysByDate: Map<string, NewDayEntry[]>;
  monthlyRequests: Map<string, number>;
  balanceNeededMap: Map<string, number>;
  totalSpanDays: number;
  totalCountedDays: number;
}

export interface CreateRequestOptions {
  targetUserId: string;
  orgId: string;
  createdBy: string;
  reason: string;
  autoApprove?: boolean;
  decisionComment?: string;
  prepared: PreparedRequest;
}

export interface ProcessValidationOptions {
  bypassBackdate?: boolean;
  bypassNotice?: boolean;
}

@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduleResolverService: ScheduleResolverService,
    private readonly balancesService: BalancesService,
    private readonly leaveYearService: LeaveYearService,
    private readonly clockService: ClockService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Internal processor for validating and calculating request segments & days.
   * Shared between preview and actual submission.
   */
  private async processAndValidateRequest(
    userId: string,
    orgId: string,
    dto: { reason?: string; segments: CreateLeaveSegmentDto[] },
    options?: ProcessValidationOptions,
  ): Promise<PreparedRequest> {
    const typeIds = [...new Set(dto.segments.map((s) => s.leaveTypeId))];
    const [org, leaveTypes] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          timezone: true,
          workingDays: true,
          backdateAllowedDays: true,
          financialYearStartMonth: true,
        },
      }),
      this.prisma.leaveType.findMany({
        where: { id: { in: typeIds }, orgId },
      }),
    ]);

    if (!org) {
      throw new LeaveRequestException(
        HttpStatus.BAD_REQUEST,
        'ORGANIZATION_NOT_FOUND',
        'Organization maujood nahi hai',
      );
    }

    if (leaveTypes.length !== typeIds.length || leaveTypes.some((t: LeaveType) => !t.active)) {
      throw new LeaveRequestException(
        HttpStatus.BAD_REQUEST,
        'LEAVE_TYPE_INACTIVE',
        'Yeh leave type active nahi hai ya doosri organization ka hai',
      );
    }

    const typeMap = new Map<string, LeaveType>(leaveTypes.map((t: LeaveType) => [t.id, t]));

    // 3. Validate segment shapes and sort by startDate
    for (const seg of dto.segments) {
      if (seg.startDate > seg.endDate) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'INVALID_SEGMENT',
          `Segment ki startDate (${seg.startDate}) endDate (${seg.endDate}) se baad nahi ho sakti`,
        );
      }

      if (DateUtil.daysBetween(seg.startDate, seg.endDate) > 366) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'INVALID_SEGMENT',
          'Ek segment zyada se zyada 366 din ka ho sakta hai',
        );
      }

      const portion = seg.portion || Portion.full;
      if (portion === Portion.first_half || portion === Portion.second_half) {
        const lt = typeMap.get(seg.leaveTypeId)!;
        if (seg.startDate !== seg.endDate || !lt.halfDayAllowed) {
          throw new LeaveRequestException(
            HttpStatus.BAD_REQUEST,
            'HALF_DAY_NOT_ALLOWED',
            'Half day sirf ek din (startDate == endDate) ke liye aur halfDayAllowed leave types par hi allowed hai',
          );
        }
      }
    }

    const sortedSegments = [...dto.segments].sort(
      (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
    );

    // 4. Calculate per-date breakdown for each segment
    const allStartDates = sortedSegments.map((s) => s.startDate);
    const allEndDates = sortedSegments.map((s) => s.endDate);
    const minDateStr = DateUtil.min(allStartDates);
    const maxDateStr = DateUtil.max(allEndDates);

    const [scheduleMap, holidays] = await Promise.all([
      this.scheduleResolverService.resolveRange(
        userId,
        minDateStr,
        maxDateStr,
        this.prisma,
        org.workingDays,
      ),
      this.prisma.holiday.findMany({
        where: {
          orgId,
          active: true,
          date: {
            gte: DateUtil.parse(minDateStr),
            lte: DateUtil.parse(maxDateStr),
          },
        },
      }),
    ]);
    const holidaySet = new Set(holidays.map((holiday) => DateUtil.format(holiday.date)));

    const processedSegments: ProcessedSegment[] = [];

    for (const seg of sortedSegments) {
      const lt = typeMap.get(seg.leaveTypeId)!;
      const portion = seg.portion || Portion.full;
      const portionValue = portion === Portion.full ? 1.0 : 0.5;

      const dateStrings = DateUtil.iterate(seg.startDate, seg.endDate);
      let segmentCounted = 0;
      const days: SegmentDayCalculation[] = [];

      for (const dateStr of dateStrings) {
        const sched = scheduleMap.get(dateStr) ?? { weeklyOff: false, weight: 1 };
        let skipReason: SkipReason = SkipReason.none;
        let occupancy = 0;
        let countedWeight = 0;

        if (sched.weeklyOff) {
          skipReason = SkipReason.weekly_off;
        } else if (holidaySet.has(dateStr)) {
          skipReason = SkipReason.holiday;
        } else {
          occupancy = portionValue;
          countedWeight = Math.min(sched.weight, portionValue);
          segmentCounted += countedWeight;
        }

        days.push({
          date: dateStr,
          leaveTypeId: seg.leaveTypeId,
          portion,
          occupancy,
          countedWeight,
          skipReason,
        });
      }

      if (segmentCounted === 0) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'ZERO_COUNTED_DAYS',
          `Is segment (${seg.startDate} se ${seg.endDate}) mein koi working day nahi hai`,
        );
      }

      processedSegments.push({
        leaveTypeId: seg.leaveTypeId,
        leaveTypeName: lt.name,
        startDate: seg.startDate,
        endDate: seg.endDate,
        portion,
        countedDays: segmentCounted,
        days,
      });
    }

    // 5. Backdate & Minimum Notice validation
    const todayStr = this.clockService.today(org.timezone);
    const earliestAllowedBackdate = DateUtil.addDays(todayStr, -org.backdateAllowedDays);

    for (const seg of processedSegments) {
      if (!options?.bypassBackdate && seg.startDate < earliestAllowedBackdate) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'BACKDATE_NOT_ALLOWED',
          `Backdated leave allowed limit (${org.backdateAllowedDays} din) se zyada purani hai. Kripya HR se on-behalf apply karwayein.`,
        );
      }

      const lt = typeMap.get(seg.leaveTypeId)!;
      if (!options?.bypassNotice && lt.minNoticeDays > 0) {
        const noticeDays = DateUtil.diffInDays(seg.startDate, todayStr);
        if (noticeDays < lt.minNoticeDays) {
          throw new LeaveRequestException(
            HttpStatus.BAD_REQUEST,
            'MIN_NOTICE',
            `${lt.name} ke liye kam se kam ${lt.minNoticeDays} din pehle apply karna zaroori hai`,
          );
        }
      }
    }

    // 6. Overlap validation
    // A. Check internal overlaps within this request's own segments
    const newDaysByDate = new Map<string, NewDayEntry[]>();

    for (let sIdx = 0; sIdx < processedSegments.length; sIdx++) {
      const seg = processedSegments[sIdx];
      for (const d of seg.days) {
        if (d.occupancy > 0) {
          const list = newDaysByDate.get(d.date) ?? [];
          list.push({ portion: d.portion, occupancy: d.occupancy });
          newDaysByDate.set(d.date, list);
        }
      }
    }

    for (const [dateStr, list] of newDaysByDate.entries()) {
      if (list.length > 1) {
        const totalOcc = list.reduce((sum, item) => sum + item.occupancy, 0);
        const hasDuplicateHalves =
          list.filter((x) => x.portion === Portion.first_half).length > 1 ||
          list.filter((x) => x.portion === Portion.second_half).length > 1 ||
          list.some((x) => x.portion === Portion.full);

        if (totalOcc > 1.0 || hasDuplicateHalves) {
          const nextFreeDate = DateUtil.addDays(dateStr, 1);
          throw new LeaveRequestException(
            HttpStatus.CONFLICT,
            'OVERLAP',
            `Ek hi request ke segments date ${dateStr} par aapas mein takra rahe hain. Aap ${nextFreeDate} se apply kar sakte ho.`,
            {
              conflicts: [
                {
                  requestId: 'same-request',
                  startDate: dateStr,
                  endDate: dateStr,
                  overlappingDates: [dateStr],
                },
              ],
              nextFreeDate,
            },
          );
        }
      }
    }

    // 7. Monthly limit validation (for all types where monthlyLimit !== null)
    const monthlyRequests = new Map<string, number>(); // key: `${leaveTypeId}_${YYYY-MM}`
    for (const seg of processedSegments) {
      const lt = typeMap.get(seg.leaveTypeId)!;
      if (lt.monthlyLimit !== null) {
        for (const d of seg.days) {
          if (d.countedWeight > 0) {
            const monthStr = d.date.substring(0, 7);
            const key = `${seg.leaveTypeId}_${monthStr}`;
            monthlyRequests.set(key, (monthlyRequests.get(key) ?? 0) + d.countedWeight);
          }
        }
      }
    }

    // 8. Balance check (for types with deductsBalance = true)
    const balanceNeededMap = new Map<string, number>(); // key: `${leaveTypeId}_${leaveYear}`
    for (const seg of processedSegments) {
      const lt = typeMap.get(seg.leaveTypeId)!;
      if (lt.deductsBalance) {
        for (const d of seg.days) {
          if (d.countedWeight > 0) {
            const leaveYear = this.leaveYearService.leaveYearOf(
              d.date,
              org.financialYearStartMonth,
            );
            const key = `${seg.leaveTypeId}_${leaveYear}`;
            balanceNeededMap.set(key, (balanceNeededMap.get(key) ?? 0) + d.countedWeight);
          }
        }
      }
    }

    const totalSpanDays = DateUtil.daysBetween(minDateStr, maxDateStr);
    const totalCountedDays = processedSegments.reduce((sum, s) => sum + s.countedDays, 0);

    return {
      leaveTypes,
      processedSegments,
      newDaysByDate,
      monthlyRequests,
      balanceNeededMap,
      totalSpanDays,
      totalCountedDays,
    };
  }

  private async validateOverlaps(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    orgId: string,
    newDaysByDate: Map<string, NewDayEntry[]>,
  ): Promise<void> {
    const occupiedDates = Array.from(newDaysByDate.keys());
    if (occupiedDates.length === 0) return;

    const existingDays = await db.leaveSegmentDay.findMany({
      where: {
        userId,
        orgId,
        date: { in: occupiedDates.map((date) => DateUtil.parse(date)) },
        occupancy: { gt: 0 },
        request: {
          status: {
            in: [
              RequestStatus.pending,
              RequestStatus.approved,
              RequestStatus.partially_approved,
            ],
          },
        },
      },
      include: {
        segment: { select: { portion: true, startDate: true, endDate: true } },
        request: { select: { id: true } },
      },
    });

    const conflictsByDate = new Map<
      string,
      Array<{
        requestId: string;
        startDate: string;
        endDate: string;
        portion: Portion;
        occupancy: number;
      }>
    >();
    for (const existing of existingDays) {
      const date = DateUtil.format(existing.date);
      const entries = conflictsByDate.get(date) ?? [];
      entries.push({
        requestId: existing.request.id,
        startDate: DateUtil.format(existing.segment.startDate),
        endDate: DateUtil.format(existing.segment.endDate),
        portion: existing.segment.portion,
        occupancy: Number(existing.occupancy),
      });
      conflictsByDate.set(date, entries);
    }

    const conflictingDates: string[] = [];
    const conflictMap = new Map<
      string,
      { requestId: string; startDate: string; endDate: string; overlappingDates: string[] }
    >();
    for (const [date, conflicts] of conflictsByDate) {
      const newEntries = newDaysByDate.get(date) ?? [];
      const newOccupancy = newEntries.reduce((sum, entry) => sum + entry.occupancy, 0);
      const existingOccupancy = conflicts.reduce((sum, entry) => sum + entry.occupancy, 0);
      const matchingHalf = conflicts.some(
        (existing) =>
          existing.occupancy === 0.5 &&
          newOccupancy === 0.5 &&
          newEntries.length === 1 &&
          ((existing.portion === Portion.first_half &&
            newEntries[0].portion === Portion.second_half) ||
            (existing.portion === Portion.second_half &&
              newEntries[0].portion === Portion.first_half)),
      );

      if (existingOccupancy + newOccupancy > 1 || !matchingHalf) {
        conflictingDates.push(date);
        for (const existing of conflicts) {
          const conflict = conflictMap.get(existing.requestId) ?? {
            requestId: existing.requestId,
            startDate: existing.startDate,
            endDate: existing.endDate,
            overlappingDates: [],
          };
          if (!conflict.overlappingDates.includes(date)) {
            conflict.overlappingDates.push(date);
          }
          conflictMap.set(existing.requestId, conflict);
        }
      }
    }

    if (conflictingDates.length === 0) return;

    const sortedConflicts = Array.from(new Set(conflictingDates)).sort();
    const maxConflictDate = sortedConflicts[sortedConflicts.length - 1];
    const firstCandidate = DateUtil.addDays(maxConflictDate, 1);
    const lastCandidate = DateUtil.addDays(maxConflictDate, 365);
    const occupiedAfterConflict = await db.leaveSegmentDay.findMany({
      where: {
        userId,
        orgId,
        date: {
          gte: DateUtil.parse(firstCandidate),
          lte: DateUtil.parse(lastCandidate),
        },
        occupancy: { gt: 0 },
        request: {
          status: {
            in: [
              RequestStatus.pending,
              RequestStatus.approved,
              RequestStatus.partially_approved,
            ],
          },
        },
      },
      select: { date: true },
    });
    const occupiedDateSet = new Set(occupiedAfterConflict.map((day) => DateUtil.format(day.date)));
    let nextFreeDate = firstCandidate;
    for (let i = 0; i < 365 && occupiedDateSet.has(nextFreeDate); i++) {
      nextFreeDate = DateUtil.addDays(nextFreeDate, 1);
    }

    const dateRange =
      sortedConflicts.length === 1
        ? sortedConflicts[0]
        : `${sortedConflicts[0]} se ${sortedConflicts[sortedConflicts.length - 1]}`;

    throw new LeaveRequestException(
      HttpStatus.CONFLICT,
      'OVERLAP',
      `${dateRange} pehle se doosri request mein hai. Aap ${nextFreeDate} se apply kar sakte ho.`,
      {
        conflicts: Array.from(conflictMap.values()),
        nextFreeDate,
      },
    );
  }

  private async validateMonthlyLimits(
    db: PrismaService | Prisma.TransactionClient,
    userId: string,
    orgId: string,
    prepared: Pick<PreparedRequest, 'monthlyRequests' | 'leaveTypes'>,
  ): Promise<void> {
    const leaveTypes = new Map(prepared.leaveTypes.map((type) => [type.id, type]));
    const monthlyUsage = await Promise.all(
      Array.from(prepared.monthlyRequests.entries()).map(async ([key, requestedWeight]) => {
        const [typeId, month] = key.split('_');
        const [yearString, monthString] = month.split('-');
        const existing = await db.leaveSegmentDay.aggregate({
          where: {
            userId,
            orgId,
            leaveTypeId: typeId,
            date: {
              gte: DateUtil.parse(`${month}-01`),
              lte: new Date(Date.UTC(Number(yearString), Number(monthString), 0)),
            },
            occupancy: { gt: 0 },
            request: {
              status: {
                in: [
                  RequestStatus.pending,
                  RequestStatus.approved,
                  RequestStatus.partially_approved,
                ],
              },
            },
          },
          _sum: { countedWeight: true },
        });
        return { key, requestedWeight, used: Number(existing._sum.countedWeight ?? 0) };
      }),
    );

    for (const { key, requestedWeight, used } of monthlyUsage) {
      const [typeId, month] = key.split('_');
      const type = leaveTypes.get(typeId)!;
      const limit = Number(type.monthlyLimit);
      if (used + requestedWeight > limit) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'MONTHLY_LIMIT_EXCEEDED',
          `${type.name} ka monthly limit (${limit} din) exceed ho raha hai mahine ${month} mein`,
          {
            leaveTypeId: typeId,
            month,
            limit,
            used,
            requested: requestedWeight,
          },
        );
      }
    }
  }

  private async validateBalances(
    userId: string,
    prepared: Pick<PreparedRequest, 'balanceNeededMap' | 'leaveTypes'>,
  ): Promise<void> {
    const entries = Array.from(prepared.balanceNeededMap.entries()).map(([key, needed]) => {
      const [leaveTypeId, yearString] = key.split('_');
      return { leaveTypeId, year: Number(yearString), needed };
    });
    if (entries.length === 0) return;

    const balances = await Promise.all(
      entries.map(({ leaveTypeId, year }) =>
        this.prisma.leaveBalance.findUnique({
          where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } },
        }),
      ),
    );
    const leaveTypes = new Map(prepared.leaveTypes.map((type) => [type.id, type]));

    for (const [index, { leaveTypeId, year, needed }] of entries.entries()) {
      const type = leaveTypes.get(leaveTypeId)!;
      const balance = balances[index];
      if (!balance) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'NO_BALANCE',
          `Saal ${year} ke liye ${type.name} ka balance allocate nahi hua hai. HR se allocation karwayein.`,
        );
      }

      const available =
        Number(balance.allocated) - Number(balance.used) - Number(balance.pending);
      if (available < needed) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'INSUFFICIENT_BALANCE',
          `Saal ${year} mein ${type.name} ka balance kam hai. Chahiye: ${needed}, bacha hai: ${available}`,
          {
            leaveTypeId,
            typeName: type.name,
            year,
            requested: needed,
            available,
          },
        );
      }
    }
  }

  /**
   * Helper: Calculates balance amounts grouped by (leaveTypeId, leaveYear) for all
   * deductsBalance leave types in a request.
   */
  async calculateBalanceAmounts(
    tx: Prisma.TransactionClient,
    requestId: string,
  ): Promise<Array<{ leaveTypeId: string; year: number; amount: number }>> {
    const req = await tx.leaveRequest.findUnique({
      where: { id: requestId },
      include: {
        organization: { select: { financialYearStartMonth: true } },
        segmentDays: {
          include: {
            leaveType: { select: { deductsBalance: true } },
          },
        },
      },
    });

    if (!req) return [];

    return this.calculateBalanceAmountsFromDays(
      req.organization?.financialYearStartMonth ?? 4,
      req.segmentDays,
    );
  }

  calculateBalanceAmountsFromDays(
    startMonth: number,
    segmentDays: Array<{
      leaveTypeId: string;
      date: Date;
      countedWeight: Prisma.Decimal;
      leaveType: { deductsBalance: boolean };
    }>,
  ): Array<{ leaveTypeId: string; year: number; amount: number }> {
    const map = new Map<string, number>();

    for (const day of segmentDays) {
      if (day.leaveType.deductsBalance && day.countedWeight.greaterThan(0)) {
        const dateStr = DateUtil.format(day.date);
        const year = this.leaveYearService.leaveYearOf(dateStr, startMonth);
        const key = `${day.leaveTypeId}_${year}`;
        map.set(key, (map.get(key) ?? 0) + Number(day.countedWeight));
      }
    }

    const result: Array<{ leaveTypeId: string; year: number; amount: number }> = [];
    for (const [key, amount] of map.entries()) {
      const [leaveTypeId, yearStr] = key.split('_');
      result.push({
        leaveTypeId,
        year: parseInt(yearStr, 10),
        amount,
      });
    }

    return result;
  }

  /**
   * Shared internal method to create and optionally auto-approve a leave request.
   * Serializes concurrency via per-user transaction advisory lock.
   */
  async createRequest(
    tx: Prisma.TransactionClient,
    options: CreateRequestOptions,
  ) {
    // Step 0: Acquire transaction-scoped advisory lock for the target user to serialize concurrent submissions
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${options.targetUserId}, 0::bigint))`,
    );

    const {
      processedSegments,
      newDaysByDate,
      monthlyRequests,
      balanceNeededMap,
      totalSpanDays,
      totalCountedDays,
    } = options.prepared;

    await this.validateOverlaps(tx, options.targetUserId, options.orgId, newDaysByDate);
    await this.validateMonthlyLimits(tx, options.targetUserId, options.orgId, {
      monthlyRequests,
      leaveTypes: options.prepared.leaveTypes,
    });

    // Reserve balances for each (leaveTypeId, year) inside transaction
    for (const [key, needed] of balanceNeededMap.entries()) {
      const [typeId, yearStr] = key.split('_');
      const year = parseInt(yearStr, 10);
      await this.balancesService.reserve(tx, options.targetUserId, typeId, year, needed);
    }

    const isAuto = options.autoApprove === true;

    // Create LeaveRequest header
    const leaveRequest = await tx.leaveRequest.create({
      data: {
        orgId: options.orgId,
        userId: options.targetUserId,
        createdBy: options.createdBy,
        reason: options.reason,
        status: isAuto ? RequestStatus.approved : RequestStatus.pending,
        decidedBy: isAuto ? options.createdBy : null,
        decidedAt: isAuto ? new Date() : null,
        decisionComment: isAuto
          ? options.decisionComment ?? 'Approved via on-behalf application'
          : null,
        spanDays: totalSpanDays,
        countedDays: new Prisma.Decimal(totalCountedDays),
      },
    });

    const segmentsWithIds = processedSegments.map((segment) => ({
      id: randomUUID(),
      segment,
    }));
    const decisionDate = new Date();
    await tx.leaveSegment.createMany({
      data: segmentsWithIds.map(({ id, segment }) => ({
        id,
        requestId: leaveRequest.id,
        orgId: options.orgId,
        userId: options.targetUserId,
        leaveTypeId: segment.leaveTypeId,
        startDate: DateUtil.parse(segment.startDate),
        endDate: DateUtil.parse(segment.endDate),
        portion: segment.portion,
        countedDays: new Prisma.Decimal(segment.countedDays),
        status: isAuto ? SegmentStatus.approved : SegmentStatus.pending,
        decidedBy: isAuto ? options.createdBy : null,
        decidedAt: isAuto ? decisionDate : null,
        decisionComment: isAuto
          ? options.decisionComment ?? 'Approved via on-behalf application'
          : null,
      })),
    });
    await tx.leaveSegmentDay.createMany({
      data: segmentsWithIds.flatMap(({ id, segment }) =>
        segment.days.map((day) => ({
          segmentId: id,
          requestId: leaveRequest.id,
          orgId: options.orgId,
          userId: options.targetUserId,
          leaveTypeId: segment.leaveTypeId,
          date: DateUtil.parse(day.date),
          occupancy: new Prisma.Decimal(day.occupancy),
          countedWeight: new Prisma.Decimal(day.countedWeight),
          skipReason: day.skipReason,
        })),
      ),
    });

    // If autoApprove, commit reserved balances immediately
    if (isAuto) {
      for (const [key, needed] of balanceNeededMap.entries()) {
        const [typeId, yearStr] = key.split('_');
        const year = parseInt(yearStr, 10);
        await this.balancesService.commit(tx, options.targetUserId, typeId, year, needed);
      }
    }

    return leaveRequest.id;
  }

  private async findCreatedRequest(id: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, role: true, department: true },
        },
        creator: {
          select: { id: true, name: true, role: true },
        },
        decider: {
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
        segmentDays: {
          orderBy: { date: 'asc' },
        },
      },
    });
    if (!request) {
      throw new NotFoundException('New leave request could not be loaded');
    }
    return request;
  }

  /**
   * 1. POST /leave-requests
   * Submits a leave request atomically inside a transaction with user-level advisory lock.
   */
  async createLeaveRequest(
    userId: string,
    orgId: string,
    role: Role,
    dto: CreateLeaveRequestDto,
  ) {
    if (role === Role.org_owner || role === Role.root) {
      throw new ForbiddenException('Owner leave apply nahi karta');
    }

    const prepared = await this.processAndValidateRequest(userId, orgId, dto);
    await this.validateBalances(userId, prepared);
    const requestId = await this.prisma.$transaction(
      async (tx) => {
        return this.createRequest(tx, {
          targetUserId: userId,
          orgId,
          createdBy: userId,
          reason: dto.reason,
          prepared,
        });
      },
    );
    return this.findCreatedRequest(requestId);
  }

  /**
   * 2. POST /leave-requests/preview
   * Performs all validations without writing to database or reserving balances.
   */
  async previewLeaveRequest(
    userId: string,
    orgId: string,
    role: Role,
    dto: CreateLeaveRequestDto,
  ) {
    if (role === Role.org_owner || role === Role.root) {
      throw new ForbiddenException('Owner leave apply nahi karta');
    }

    const prepared = await this.processAndValidateRequest(userId, orgId, dto);
    await this.validateOverlaps(
      this.prisma,
      userId,
      orgId,
      prepared.newDaysByDate,
    );
    await this.validateMonthlyLimits(this.prisma, userId, orgId, prepared);
    await this.validateBalances(userId, prepared);
    const { processedSegments, totalSpanDays, totalCountedDays } = prepared;

    const breakdown: Array<{
      date: string;
      leaveTypeId: string;
      leaveTypeName: string;
      portion: Portion;
      occupancy: number;
      countedWeight: number;
      skipReason: SkipReason;
    }> = [];

    const segments = processedSegments.map((s) => {
      for (const d of s.days) {
        breakdown.push({
          date: d.date,
          leaveTypeId: s.leaveTypeId,
          leaveTypeName: s.leaveTypeName,
          portion: s.portion,
          occupancy: d.occupancy,
          countedWeight: d.countedWeight,
          skipReason: d.skipReason,
        });
      }

      return {
        leaveTypeId: s.leaveTypeId,
        leaveTypeName: s.leaveTypeName,
        startDate: s.startDate,
        endDate: s.endDate,
        portion: s.portion,
        countedDays: s.countedDays,
      };
    });

    return {
      spanDays: totalSpanDays,
      countedDays: totalCountedDays,
      segments,
      breakdown,
    };
  }

  /**
   * 3. GET /leave-requests/mine
   * Paginated listing of personal leave requests with date range and status filters.
   */
  async getMyRequests(
    userId: string,
    orgId: string,
    query: QueryLeaveRequestsDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.LeaveRequestWhereInput = {
      orgId,
      userId,
      ...(query.status && { status: query.status }),
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
        orderBy: { createdAt: 'desc' },
        include: {
          segments: {
            include: {
              leaveType: {
                select: { id: true, name: true, isWfh: true },
              },
            },
            orderBy: { startDate: 'asc' },
          },
          decider: {
            select: { id: true, name: true },
          },
        },
      }),
    ]);

    const items = requests.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      spanDays: r.spanDays,
      countedDays: r.countedDays,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      decisionComment: r.decisionComment,
      decidedBy: r.decider ? r.decider.name : null,
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
    }));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * 4. GET /leave-requests/:id
   * Request owner or HR_ADMIN+ in the same org can view detail. Others get 404.
   */
  async getRequestById(
    userId: string,
    orgId: string,
    role: Role,
    id: string,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        segments: {
          include: {
            leaveType: {
              select: { id: true, name: true, isWfh: true },
            },
          },
          orderBy: { startDate: 'asc' },
        },
        segmentDays: {
          orderBy: { date: 'asc' },
        },
        decider: {
          select: { id: true, name: true },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    const isOwner = request.userId === userId;
    const isHrOrAbove =
      role === Role.hr_admin || role === Role.org_owner || role === Role.root;

    if (!isOwner && !isHrOrAbove) {
      throw new NotFoundException('Leave request not found');
    }

    return {
      id: request.id,
      userId: request.userId,
      reason: request.reason,
      status: request.status,
      spanDays: request.spanDays,
      countedDays: request.countedDays,
      createdAt: request.createdAt,
      decidedAt: request.decidedAt,
      decisionComment: request.decisionComment,
      decidedBy: request.decider ? request.decider.name : null,
      cancelledAt: request.cancelledAt,
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
    };
  }

  /**
   * 5. POST /leave-requests/:id/cancel
   * Cancels a pending request and releases reserved balances.
   */
  async cancelLeaveRequest(userId: string, orgId: string, id: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        user: { select: { id: true, name: true, role: true, managerId: true } },
        organization: { select: { financialYearStartMonth: true } },
        segments: {
          include: {
            leaveType: { select: { isWfh: true, deductsBalance: true } },
          },
        },
        segmentDays: {
          include: {
            leaveType: { select: { deductsBalance: true } },
          },
        },
      },
    });

    if (!request || request.userId !== userId) {
      throw new NotFoundException('Leave request not found');
    }
    if (request.status !== RequestStatus.pending) {
      throw new LeaveRequestException(
        HttpStatus.CONFLICT,
        'CANNOT_CANCEL_REQUEST',
        `Sirf pending request cancel ho sakti hai. Current status: ${request.status}`,
      );
    }

    const balances = this.calculateBalanceAmountsFromDays(
      request.organization?.financialYearStartMonth ?? 4,
      request.segmentDays,
    );

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${userId}, 0::bigint))`,
        );

        const updateRes = await tx.leaveRequest.updateMany({
          where: {
            id,
            orgId,
            userId,
            status: RequestStatus.pending,
          },
          data: {
            status: RequestStatus.cancelled,
            cancelledAt: new Date(),
          },
        });

        if (updateRes.count === 0) {
          throw new LeaveRequestException(
            HttpStatus.CONFLICT,
            'CANNOT_CANCEL_REQUEST',
            'Request was updated concurrently or is no longer pending',
          );
        }

        // Cancel pending segments
        await tx.leaveSegment.updateMany({
          where: { requestId: id, status: SegmentStatus.pending },
          data: { status: SegmentStatus.cancelled },
        });

        // Set occupancy to 0 on all segment days
        await tx.leaveSegmentDay.updateMany({
          where: { requestId: id },
          data: { occupancy: 0 },
        });

        for (const b of balances) {
          await this.balancesService.release(tx, userId, b.leaveTypeId, b.year, b.amount);
        }

        // Send cancellation notifications
        await this.notificationsService.createCancellationNotifications(tx, {
          orgId,
          requestId: id,
          cancelledBy: 'staff',
          requester: {
            id: request.user.id,
            name: request.user.name,
            managerId: request.user.managerId,
          },
          segments: request.segments.map((s) => ({
            isWfh: s.leaveType.isWfh,
            startDate: s.startDate,
            endDate: s.endDate,
            portion: s.portion,
          })),
        });

        return {
          message: 'Leave request cancelled successfully',
          id: request.id,
          status: RequestStatus.cancelled,
        };
      },
    );
  }

  /**
   * 6. POST /leave-requests/on-behalf (@MinRole(Role.HR_ADMIN))
   * Submits leave on behalf of another user with backdate and notice bypassed.
   */
  async applyOnBehalf(
    callerId: string,
    callerRole: Role,
    orgId: string,
    dto: CreateOnBehalfDto,
  ) {
    if (callerId === dto.userId) {
      throw new ForbiddenException('Apne liye on-behalf apply nahi kar sakte');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        orgId,
        active: true,
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found or inactive in this organization');
    }

    if (
      targetUser.role !== Role.staff &&
      targetUser.role !== Role.manager &&
      targetUser.role !== Role.hr_admin
    ) {
      throw new BadRequestException(
        'On-behalf sirf staff, manager ya hr_admin ke liye apply ho sakti hai',
      );
    }

    // canDecide rule: if target is hr_admin, caller MUST be org_owner
    if (!canDecide({ id: callerId, role: callerRole, orgId }, targetUser)) {
      throw new ForbiddenException(
        'HR Admin ke liye on-behalf sirf Org Owner apply kar sakta hai',
      );
    }

    const autoApprove = dto.autoApprove ?? true;
    const prepared = await this.processAndValidateRequest(
      targetUser.id,
      orgId,
      dto,
      { bypassBackdate: true, bypassNotice: true },
    );
    await this.validateBalances(targetUser.id, prepared);
    const requestId = await this.prisma.$transaction(
      async (tx) => {
        return this.createRequest(tx, {
          targetUserId: targetUser.id,
          orgId,
          createdBy: callerId,
          reason: dto.reason,
          autoApprove,
          decisionComment: dto.onBehalfReason,
          prepared,
        });
      },
    );

    const result = await this.findCreatedRequest(requestId);
    await this.auditService.log({
      orgId,
      actorId: callerId,
      targetUserId: targetUser.id,
      action: AuditAction.LEAVE_APPLIED_ON_BEHALF,
      reason: dto.onBehalfReason,
      metadata: {
        requestId: result?.id,
        onBehalfReason: dto.onBehalfReason,
        autoApprove,
        countedDays: result?.countedDays ? result.countedDays.toString() : '0',
      },
    });

    return result;
  }

  /**
   * 7. POST /leave-requests/:id/cancel-approved (@MinRole(Role.HR_ADMIN))
   * HR cancels an approved leave request, refunds balance to used, and logs audit.
   */
  async cancelApprovedRequest(
    callerId: string,
    callerRole: Role,
    orgId: string,
    id: string,
    dto: CancelApprovedLeaveDto,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id, orgId },
      include: {
        user: { select: { id: true, name: true, role: true, orgId: true, managerId: true } },
        organization: { select: { financialYearStartMonth: true } },
        segments: {
          include: {
            leaveType: { select: { id: true, isWfh: true, deductsBalance: true } },
            segmentDays: {
              include: {
                leaveType: { select: { deductsBalance: true } },
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    // Check canDecide rule
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new ForbiddenException('Aap is approved leave ko cancel nahi kar sakte');
    }

    if (
      request.status !== RequestStatus.approved &&
      request.status !== RequestStatus.partially_approved
    ) {
      throw new ConflictException(
        `Sirf approved ya partially approved request cancel ho sakti hai. Current status: ${request.status}`,
      );
    }

    const approvedSegments = request.segments.filter(
      (s) => s.status === SegmentStatus.approved,
    );
    const approvedSegmentIds = approvedSegments.map((s) => s.id);
    const approvedDays = approvedSegments.flatMap((s) => s.segmentDays);

    const balances = this.calculateBalanceAmountsFromDays(
      request.organization?.financialYearStartMonth ?? 4,
      approvedDays,
    );
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${request.userId}, 0::bigint))`,
        );

        // Atomically update status to cancelled without overwriting decisionComment
        const updateRes = await tx.leaveRequest.updateMany({
          where: {
            id,
            orgId,
            status: { in: [RequestStatus.approved, RequestStatus.partially_approved] },
          },
          data: {
            status: RequestStatus.cancelled,
            cancelledAt: new Date(),
          },
        });

        if (updateRes.count === 0) {
          throw new ConflictException('Request was updated concurrently or is no longer approved');
        }

        // Cancel approved segments
        if (approvedSegmentIds.length > 0) {
          await tx.leaveSegment.updateMany({
            where: { id: { in: approvedSegmentIds } },
            data: { status: SegmentStatus.cancelled },
          });

          // Zero occupancy for approved segment days
          await tx.leaveSegmentDay.updateMany({
            where: { segmentId: { in: approvedSegmentIds } },
            data: { occupancy: 0 },
          });
        }

        for (const b of balances) {
          await this.balancesService.refund(tx, request.userId, b.leaveTypeId, b.year, b.amount);
        }

        await this.auditService.log({
          orgId,
          actorId: callerId,
          targetUserId: request.userId,
          action: AuditAction.LEAVE_CANCELLED_BY_HR,
          reason: dto.reason,
          metadata: {
            requestId: id,
            requesterId: request.userId,
            reason: dto.reason,
          },
        }, tx);

        // Send cancellation notifications
        await this.notificationsService.createCancellationNotifications(tx, {
          orgId,
          requestId: id,
          cancelledBy: 'hr',
          requester: {
            id: request.user.id,
            name: request.user.name,
            managerId: request.user.managerId,
          },
          segments: approvedSegments.map((s) => ({
            isWfh: s.leaveType.isWfh,
            startDate: s.startDate,
            endDate: s.endDate,
            portion: s.portion,
          })),
        });

        return {
          message: 'Approved leave request cancelled successfully',
          id,
          status: RequestStatus.cancelled,
        };
      },
    );
    return result;
  }

  /**
   * 8. GET /leave-requests (@MinRole(Role.HR_ADMIN))
   * Paginated listing of all organization leave requests for HR history.
   */
  async getAllRequests(
    orgId: string,
    query: QueryAllRequestsDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.LeaveRequestWhereInput = {
      orgId,
      ...(query.status && { status: query.status }),
      ...(query.userId && { userId: query.userId }),
      ...(query.department && {
        user: {
          department: { contains: query.department, mode: 'insensitive' },
        },
      }),
      ...(query.leaveTypeId && {
        segments: {
          some: {
            leaveTypeId: query.leaveTypeId,
          },
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
        orderBy: { createdAt: 'desc' },
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
          decider: {
            select: { id: true, name: true },
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
        email: r.user.email,
        role: r.user.role,
        department: r.user.department,
      },
      status: r.status,
      reason: r.reason,
      spanDays: r.spanDays,
      countedDays: r.countedDays,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      decidedBy: r.decider ? r.decider.name : null,
      decisionComment: r.decisionComment,
      cancelledAt: r.cancelledAt,
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
    }));

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Hook for user deactivation: automatically cancels all pending requests and releases reserved balances.
   */
  async cancelUserPendingRequestsOnDeactivation(
    tx: Prisma.TransactionClient,
    orgId: string,
    userId: string,
    actorId: string,
  ): Promise<string[]> {
    // Acquire transaction-scoped advisory lock for the user
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${userId}, 0::bigint))`,
    );

    const pendingRequests = await tx.leaveRequest.findMany({
      where: { userId, orgId, status: RequestStatus.pending },
      select: { id: true },
    });

    if (pendingRequests.length === 0) {
      return [];
    }

    const requestIds = pendingRequests.map((r) => r.id);

    await tx.leaveRequest.updateMany({
      where: { id: { in: requestIds }, status: RequestStatus.pending },
      data: {
        status: RequestStatus.cancelled,
        cancelledAt: new Date(),
      },
    });

    await tx.leaveSegment.updateMany({
      where: { requestId: { in: requestIds }, status: SegmentStatus.pending },
      data: { status: SegmentStatus.cancelled },
    });

    await tx.leaveSegmentDay.updateMany({
      where: { requestId: { in: requestIds } },
      data: { occupancy: 0 },
    });

    for (const reqId of requestIds) {
      const balances = await this.calculateBalanceAmounts(tx, reqId);
      for (const b of balances) {
        await this.balancesService.release(tx, userId, b.leaveTypeId, b.year, b.amount);
      }
    }

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: userId,
      action: AuditAction.LEAVE_AUTO_CANCELLED,
      reason: 'User deactivated',
      metadata: { requestIds },
    });

    return requestIds;
  }
}
