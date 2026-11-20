import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Holiday,
  LeaveType,
  Portion,
  Prisma,
  RequestStatus,
  Role,
  SkipReason,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduleResolverService } from '../schedules/schedule-resolver.service';
import { BalancesService } from '../balances/balances.service';
import { LeaveYearService } from '../balances/leave-year.service';
import { ClockService } from '../common/services/clock.service';
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

export interface CreateRequestOptions {
  targetUserId: string;
  orgId: string;
  createdBy: string;
  reason: string;
  segments: CreateLeaveSegmentDto[];
  bypassBackdate?: boolean;
  bypassNotice?: boolean;
  autoApprove?: boolean;
  decisionComment?: string;
}

export interface ProcessValidationOptions {
  isDryRun?: boolean;
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
  ) {}

  /**
   * Internal processor for validating and calculating request segments & days.
   * Shared between preview and actual submission.
   */
  private async processAndValidateRequest(
    userId: string,
    orgId: string,
    dto: { reason?: string; segments: CreateLeaveSegmentDto[] },
    isDryRun = false,
    client?: PrismaService | Prisma.TransactionClient,
    options?: ProcessValidationOptions,
  ) {
    const db = (client as any) ?? this.prisma;

    // 1. Fetch organization
    const org = await db.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      throw new LeaveRequestException(
        HttpStatus.BAD_REQUEST,
        'ORGANIZATION_NOT_FOUND',
        'Organization maujood nahi hai',
      );
    }

    // 2. Fetch all leave types referenced in segments
    const typeIds = [...new Set(dto.segments.map((s) => s.leaveTypeId))];
    const leaveTypes: LeaveType[] = await db.leaveType.findMany({
      where: {
        id: { in: typeIds },
        orgId,
      },
    });

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

    const scheduleMap = await this.scheduleResolverService.resolveRange(
      userId,
      minDateStr,
      maxDateStr,
      db,
      org.workingDays,
    );

    const holidays: Holiday[] = await db.holiday.findMany({
      where: {
        orgId,
        active: true,
        date: {
          gte: DateUtil.parse(minDateStr),
          lte: DateUtil.parse(maxDateStr),
        },
      },
    });
    const holidaySet = new Set(holidays.map((h: Holiday) => DateUtil.format(h.date)));

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
    const newDaysByDate = new Map<
      string,
      Array<{ portion: Portion; occupancy: number; segIdx: number }>
    >();

    for (let sIdx = 0; sIdx < processedSegments.length; sIdx++) {
      const seg = processedSegments[sIdx];
      for (const d of seg.days) {
        if (d.occupancy > 0) {
          const list = newDaysByDate.get(d.date) ?? [];
          list.push({ portion: d.portion, occupancy: d.occupancy, segIdx: sIdx });
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

    // B. Check external overlaps with existing pending or approved requests for this user
    const occupiedDates = Array.from(newDaysByDate.keys());
    if (occupiedDates.length > 0) {
      const occupiedDateObjs = occupiedDates.map((d) => DateUtil.parse(d));

      const existingDays = await db.leaveSegmentDay.findMany({
        where: {
          userId,
          orgId,
          date: { in: occupiedDateObjs },
          occupancy: { gt: 0 },
          request: {
            status: { in: [RequestStatus.pending, RequestStatus.approved] },
          },
        },
        include: {
          segment: { select: { portion: true, startDate: true, endDate: true } },
          request: { select: { id: true } },
        },
      });

      const conflictingDates: string[] = [];
      const conflictMap = new Map<
        string,
        { requestId: string; startDate: string; endDate: string; overlappingDates: string[] }
      >();

      for (const exDay of existingDays) {
        const dateStr = DateUtil.format(exDay.date);
        const newEntries = newDaysByDate.get(dateStr) || [];
        const existingOcc = Number(exDay.occupancy);
        const newOcc = newEntries.reduce((acc, curr) => acc + curr.occupancy, 0);
        const totalOcc = existingOcc + newOcc;

        const isBothHalfDistinct =
          existingOcc === 0.5 &&
          newOcc === 0.5 &&
          ((exDay.segment.portion === Portion.first_half &&
            newEntries[0].portion === Portion.second_half) ||
            (exDay.segment.portion === Portion.second_half &&
              newEntries[0].portion === Portion.first_half));

        if (totalOcc > 1.0 || !isBothHalfDistinct) {
          conflictingDates.push(dateStr);
          const reqId = exDay.request.id;
          const conf = conflictMap.get(reqId) ?? {
            requestId: reqId,
            startDate: DateUtil.format(exDay.segment.startDate),
            endDate: DateUtil.format(exDay.segment.endDate),
            overlappingDates: [] as string[],
          };
          if (!conf.overlappingDates.includes(dateStr)) {
            conf.overlappingDates.push(dateStr);
          }
          conflictMap.set(reqId, conf);
        }
      }

      if (conflictingDates.length > 0) {
        const sortedConflicts = Array.from(new Set(conflictingDates)).sort();
        const maxConfDate = sortedConflicts[sortedConflicts.length - 1];

        // Find next free date starting right after the latest conflicting date
        let probe = DateUtil.addDays(maxConfDate, 1);
        for (let i = 0; i < 365; i++) {
          const probeObj = DateUtil.parse(probe);
          const occupiedCount = await db.leaveSegmentDay.count({
            where: {
              userId,
              orgId,
              date: probeObj,
              occupancy: { gt: 0 },
              request: {
                status: { in: [RequestStatus.pending, RequestStatus.approved] },
              },
            },
          });
          if (occupiedCount === 0) {
            break;
          }
          probe = DateUtil.addDays(probe, 1);
        }

        const dateRangeStr =
          sortedConflicts.length === 1
            ? sortedConflicts[0]
            : `${sortedConflicts[0]} se ${sortedConflicts[sortedConflicts.length - 1]}`;

        throw new LeaveRequestException(
          HttpStatus.CONFLICT,
          'OVERLAP',
          `${dateRangeStr} pehle se doosri request mein hai. Aap ${probe} se apply kar sakte ho.`,
          {
            conflicts: Array.from(conflictMap.values()),
            nextFreeDate: probe,
          },
        );
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

    for (const [key, requestedWeight] of monthlyRequests.entries()) {
      const [typeId, monthStr] = key.split('_');
      const lt = typeMap.get(typeId)!;
      const [yStr, mStr] = monthStr.split('-');
      const startOfMonth = DateUtil.parse(`${monthStr}-01`);
      const endOfMonth = new Date(Date.UTC(parseInt(yStr, 10), parseInt(mStr, 10), 0));

      const existingAgg = await db.leaveSegmentDay.aggregate({
        where: {
          userId,
          orgId,
          leaveTypeId: typeId,
          date: { gte: startOfMonth, lte: endOfMonth },
          request: {
            status: { in: [RequestStatus.pending, RequestStatus.approved] },
          },
        },
        _sum: { countedWeight: true },
      });

      const usedInMonth = existingAgg._sum.countedWeight
        ? Number(existingAgg._sum.countedWeight)
        : 0;
      const totalMonth = usedInMonth + requestedWeight;
      const limit = Number(lt.monthlyLimit);

      if (totalMonth > limit) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'MONTHLY_LIMIT_EXCEEDED',
          `${lt.name} ka monthly limit (${limit} din) exceed ho raha hai mahine ${monthStr} mein`,
          {
            leaveTypeId: typeId,
            month: monthStr,
            limit,
            used: usedInMonth,
            requested: requestedWeight,
          },
        );
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

    for (const [key, needed] of balanceNeededMap.entries()) {
      const [typeId, yearStr] = key.split('_');
      const year = parseInt(yearStr, 10);
      const lt = typeMap.get(typeId)!;

      const balance = await db.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId,
            leaveTypeId: typeId,
            year,
          },
        },
      });

      if (!balance) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'NO_BALANCE',
          `Saal ${year} ke liye ${lt.name} ka balance allocate nahi hua hai. HR se allocation karwayein.`,
        );
      }

      const available =
        Number(balance.allocated) - Number(balance.used) - Number(balance.pending);

      if (available < needed) {
        throw new LeaveRequestException(
          HttpStatus.BAD_REQUEST,
          'INSUFFICIENT_BALANCE',
          `Saal ${year} mein ${lt.name} ka balance kam hai. Chahiye: ${needed}, bacha hai: ${available}`,
          {
            leaveTypeId: typeId,
            typeName: lt.name,
            year,
            requested: needed,
            available,
          },
        );
      }
    }

    const totalSpanDays = DateUtil.daysBetween(minDateStr, maxDateStr);
    const totalCountedDays = processedSegments.reduce((sum, s) => sum + s.countedDays, 0);

    return {
      org,
      processedSegments,
      balanceNeededMap,
      totalSpanDays,
      totalCountedDays,
    };
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

    const startMonth = req.organization?.financialYearStartMonth ?? 4;
    const map = new Map<string, number>();

    for (const day of req.segmentDays) {
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

    // Steps 1 - 8: Validate and calculate
    const { processedSegments, balanceNeededMap, totalSpanDays, totalCountedDays } =
      await this.processAndValidateRequest(
        options.targetUserId,
        options.orgId,
        { reason: options.reason, segments: options.segments },
        false,
        tx,
        {
          bypassBackdate: options.bypassBackdate,
          bypassNotice: options.bypassNotice,
        },
      );

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

    // Create segments and segment days
    for (const seg of processedSegments) {
      const leaveSegment = await tx.leaveSegment.create({
        data: {
          requestId: leaveRequest.id,
          orgId: options.orgId,
          userId: options.targetUserId,
          leaveTypeId: seg.leaveTypeId,
          startDate: DateUtil.parse(seg.startDate),
          endDate: DateUtil.parse(seg.endDate),
          portion: seg.portion,
          countedDays: new Prisma.Decimal(seg.countedDays),
        },
      });

      await tx.leaveSegmentDay.createMany({
        data: seg.days.map((d) => ({
          segmentId: leaveSegment.id,
          requestId: leaveRequest.id,
          orgId: options.orgId,
          userId: options.targetUserId,
          leaveTypeId: seg.leaveTypeId,
          date: DateUtil.parse(d.date),
          occupancy: new Prisma.Decimal(d.occupancy),
          countedWeight: new Prisma.Decimal(d.countedWeight),
          skipReason: d.skipReason,
        })),
      });
    }

    // If autoApprove, commit reserved balances immediately
    if (isAuto) {
      for (const [key, needed] of balanceNeededMap.entries()) {
        const [typeId, yearStr] = key.split('_');
        const year = parseInt(yearStr, 10);
        await this.balancesService.commit(tx, options.targetUserId, typeId, year, needed);
      }
    }

    // Return full entity with relations
    return tx.leaveRequest.findUnique({
      where: { id: leaveRequest.id },
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

    const txTimeout = parseInt(process.env.PRISMA_TRANSACTION_TIMEOUT || '30000', 10);
    const txMaxWait = parseInt(process.env.PRISMA_TRANSACTION_MAX_WAIT || '10000', 10);
    return this.prisma.$transaction(
      async (tx) => {
        return this.createRequest(tx, {
          targetUserId: userId,
          orgId,
          createdBy: userId,
          reason: dto.reason,
          segments: dto.segments,
        });
      },
      { timeout: txTimeout, maxWait: txMaxWait },
    );
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

    const { processedSegments, totalSpanDays, totalCountedDays } =
      await this.processAndValidateRequest(userId, orgId, dto, true);

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
    return this.prisma.$transaction(
      async (tx) => {
        // Step 0: Acquire transaction-scoped advisory lock for the user
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${userId}, 0::bigint))`,
        );

        // 1. Fetch request with segmentDays and leaveType
        const req = await tx.leaveRequest.findFirst({
          where: { id, orgId },
          include: {
            segmentDays: {
              include: {
                leaveType: {
                  select: { deductsBalance: true },
                },
              },
            },
          },
        });

        if (!req || req.userId !== userId) {
          throw new NotFoundException('Leave request not found');
        }

        if (req.status !== RequestStatus.pending) {
          throw new LeaveRequestException(
            HttpStatus.CONFLICT,
            'CANNOT_CANCEL_REQUEST',
            `Sirf pending request cancel ho sakti hai. Current status: ${req.status}`,
          );
        }

        // 2. Atomically update status to cancelled
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

        // 3. Release reserved balance for deductsBalance leave types using calculateBalanceAmounts
        const balances = await this.calculateBalanceAmounts(tx, id);
        for (const b of balances) {
          await this.balancesService.release(tx, userId, b.leaveTypeId, b.year, b.amount);
        }

        return {
          message: 'Leave request cancelled successfully',
          id: req.id,
          status: RequestStatus.cancelled,
        };
      },
      { timeout: 15000 },
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

    const txTimeout = parseInt(process.env.PRISMA_TRANSACTION_TIMEOUT || '30000', 10);
    const txMaxWait = parseInt(process.env.PRISMA_TRANSACTION_MAX_WAIT || '10000', 10);
    const result = await this.prisma.$transaction(
      async (tx) => {
        return this.createRequest(tx, {
          targetUserId: targetUser.id,
          orgId,
          createdBy: callerId,
          reason: dto.reason,
          segments: dto.segments,
          bypassBackdate: true,
          bypassNotice: true,
          autoApprove,
          decisionComment: dto.onBehalfReason,
        });
      },
      { timeout: txTimeout, maxWait: txMaxWait },
    );

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
        user: { select: { id: true, role: true, orgId: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found');
    }

    // Check canDecide rule
    if (!canDecide({ id: callerId, role: callerRole, orgId }, request.user)) {
      throw new ForbiddenException('Aap is approved leave ko cancel nahi kar sakte');
    }

    if (request.status !== RequestStatus.approved) {
      throw new ConflictException(
        `Sirf approved request cancel ho sakti hai. Current status: ${request.status}`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Step 0: Acquire transaction-scoped advisory lock for the requester
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('leave:' || ${request.userId}, 0::bigint))`,
        );

        // Atomically update status to cancelled without overwriting decisionComment
        const updateRes = await tx.leaveRequest.updateMany({
          where: { id, orgId, status: RequestStatus.approved },
          data: {
            status: RequestStatus.cancelled,
            cancelledAt: new Date(),
          },
        });

        if (updateRes.count === 0) {
          throw new ConflictException('Request was updated concurrently or is no longer approved');
        }

        // Refund balances using calculateBalanceAmounts
        const balances = await this.calculateBalanceAmounts(tx, id);
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
        });

        return {
          message: 'Approved leave request cancelled successfully',
          id,
          status: RequestStatus.cancelled,
        };
      },
      { timeout: 15000 },
    );
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
