import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  LeaveBalance,
  Prisma,
  RequestStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import { LeaveYearService } from './leave-year.service';
import { AllocateBalancesDto } from './dto/allocate-balances.dto';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import { QueryBalancesDto } from './dto/query-balances.dto';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly leaveYearService: LeaveYearService,
  ) {}

  /**
   * 1. POST /balances/allocate
   * Allocates prorated leave balances for eligible employees for a given leave year.
   * Idempotent: Skips (userId, leaveTypeId, year) rows that already exist without overwriting.
   */
  async allocateBalances(
    actorId: string,
    orgId: string,
    dto: AllocateBalancesDto,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    // Eligible users: staff, manager, hr_admin, active
    const users = await this.prisma.user.findMany({
      where: {
        orgId,
        active: true,
        role: { in: [Role.staff, Role.manager, Role.hr_admin] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        joiningDate: true,
      },
    });

    // Eligible leave types: active, deductsBalance = true, daysPerYear != null
    const leaveTypeWhere: Prisma.LeaveTypeWhereInput = {
      orgId,
      active: true,
      deductsBalance: true,
      daysPerYear: { not: null },
      ...(dto.leaveTypeIds &&
        dto.leaveTypeIds.length > 0 && {
          id: { in: dto.leaveTypeIds },
        }),
    };

    const leaveTypes = await this.prisma.leaveType.findMany({
      where: leaveTypeWhere,
    });

    // Fetch existing balances in one query for fast lookup
    const existingBalances = await this.prisma.leaveBalance.findMany({
      where: {
        orgId,
        year: dto.year,
        ...(dto.leaveTypeIds &&
          dto.leaveTypeIds.length > 0 && {
            leaveTypeId: { in: dto.leaveTypeIds },
          }),
      },
      select: {
        userId: true,
        leaveTypeId: true,
      },
    });

    const existingKeySet = new Set(
      existingBalances.map((b) => `${b.userId}_${b.leaveTypeId}`),
    );

    let created = 0;
    let skipped = 0;
    const items: Array<{
      userId: string;
      userName: string;
      leaveTypeId: string;
      leaveTypeName: string;
      year: number;
      allocated: string;
    }> = [];

    const toCreate: Array<{
      orgId: string;
      userId: string;
      leaveTypeId: string;
      year: number;
      allocated: Prisma.Decimal;
      used: Prisma.Decimal;
      pending: Prisma.Decimal;
    }> = [];

    for (const user of users) {
      for (const lt of leaveTypes) {
        const key = `${user.id}_${lt.id}`;
        if (existingKeySet.has(key)) {
          skipped++;
          continue;
        }

        const prorated = this.leaveYearService.prorate(
          lt.daysPerYear!,
          user.joiningDate,
          dto.year,
          org.financialYearStartMonth,
        );

        if (prorated === null) {
          // Employee joined after this leave year ended
          skipped++;
          continue;
        }

        created++;
        if (dto.dryRun) {
          items.push({
            userId: user.id,
            userName: user.name,
            leaveTypeId: lt.id,
            leaveTypeName: lt.name,
            year: dto.year,
            allocated: prorated.toString(),
          });
        } else {
          toCreate.push({
            orgId,
            userId: user.id,
            leaveTypeId: lt.id,
            year: dto.year,
            allocated: prorated,
            used: new Prisma.Decimal(0),
            pending: new Prisma.Decimal(0),
          });
        }
      }
    }

    if (!dto.dryRun && toCreate.length > 0) {
      await this.prisma.leaveBalance.createMany({
        data: toCreate,
        skipDuplicates: true,
      });

      await this.auditService.log({
        orgId,
        actorId,
        action: AuditAction.BALANCES_ALLOCATED,
        reason: `Allocated annual leave balances for year ${dto.year}`,
        metadata: {
          year: dto.year,
          created,
          skipped,
        },
      });
    }

    return {
      created,
      skipped,
      ...(dto.dryRun ? { items } : {}),
    };
  }

  /**
   * 2. POST /balances/adjust
   * Manually adjusts employee leave balance (positive or negative).
   * Resulting available balance (allocated - used - pending) must never be negative.
   */
  async adjustBalance(actorId: string, orgId: string, dto: AdjustBalanceDto) {
    if (dto.delta === 0) {
      throw new BadRequestException('Adjustment delta cannot be 0');
    }

    // Verify user belongs to same org and has eligible role
    const user = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        orgId,
        active: true,
        role: { in: [Role.staff, Role.manager, Role.hr_admin] },
      },
    });

    if (!user) {
      throw new NotFoundException(
        'User not found or is ineligible for leave balance in this organization',
      );
    }

    // Verify leave type belongs to same org and deducts balance
    const leaveType = await this.prisma.leaveType.findFirst({
      where: {
        id: dto.leaveTypeId,
        orgId,
        deductsBalance: true,
      },
    });

    if (!leaveType) {
      throw new NotFoundException(
        'Leave type not found or does not deduct balance in this organization',
      );
    }

    const deltaDecimal = new Prisma.Decimal(dto.delta);

    const result = await this.prisma.$transaction(async (tx) => {
      let balance = await tx.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: dto.userId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
          },
        },
      });

      // If no row exists yet, initialize with 0
      if (!balance) {
        balance = await tx.leaveBalance.create({
          data: {
            orgId,
            userId: dto.userId,
            leaveTypeId: dto.leaveTypeId,
            year: dto.year,
            allocated: new Prisma.Decimal(0),
            used: new Prisma.Decimal(0),
            pending: new Prisma.Decimal(0),
          },
        });
      }

      const newAllocated = balance.allocated.plus(deltaDecimal);
      const newAvailable = newAllocated
        .minus(balance.used)
        .minus(balance.pending);

      if (newAvailable.isNegative()) {
        throw new ConflictException(
          'Adjustment rejected: available balance (allocated - used - pending) would become negative',
        );
      }

      const updatedBalance = await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { allocated: newAllocated },
      });

      const adjustment = await tx.balanceAdjustment.create({
        data: {
          orgId,
          balanceId: balance.id,
          delta: deltaDecimal,
          reason: dto.reason,
          actorId,
        },
      });

      return {
        balance: updatedBalance,
        available: newAvailable,
        adjustment,
        beforeAllocated: balance.allocated,
      };
    });

    await this.auditService.log({
      orgId,
      actorId,
      targetUserId: dto.userId,
      action: AuditAction.BALANCE_ADJUSTED,
      reason: dto.reason,
      metadata: {
        balanceId: result.balance.id,
        year: dto.year,
        delta: dto.delta,
        before: { allocated: result.beforeAllocated.toString() },
        after: { allocated: result.balance.allocated.toString() },
      },
    });

    return {
      ...result.balance,
      available: result.available,
      adjustment: result.adjustment,
    };
  }

  /**
   * 3. GET /balances
   * Paginated listing of leave balances with employee and leave type details.
   */
  async getBalances(
    orgId: string,
    query: QueryBalancesDto,
  ): Promise<PaginatedResult<any>> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { financialYearStartMonth: true },
    });

    const targetYear =
      query.year ??
      this.leaveYearService.leaveYearOf(
        new Date(),
        org?.financialYearStartMonth ?? 4,
      );

    const where: Prisma.LeaveBalanceWhereInput = {
      orgId,
      year: targetYear,
      ...(query.userId && { userId: query.userId }),
      ...(query.leaveTypeId && { leaveTypeId: query.leaveTypeId }),
      ...(query.department && {
        user: {
          department: { contains: query.department, mode: 'insensitive' },
        },
      }),
    };

    const [total, balances] = await Promise.all([
      this.prisma.leaveBalance.count({ where }),
      this.prisma.leaveBalance.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: [{ user: { name: 'asc' } }, { leaveType: { name: 'asc' } }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              department: true,
              role: true,
            },
          },
          leaveType: {
            select: {
              id: true,
              name: true,
              isWfh: true,
            },
          },
        },
      }),
    ]);

    const items = balances.map((b) => {
      const available = b.allocated.minus(b.used).minus(b.pending);
      return {
        id: b.id,
        orgId: b.orgId,
        userId: b.userId,
        userName: b.user.name,
        userEmail: b.user.email,
        department: b.user.department,
        leaveTypeId: b.leaveTypeId,
        leaveTypeName: b.leaveType.name,
        year: b.year,
        allocated: b.allocated,
        used: b.used,
        pending: b.pending,
        available,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      };
    });

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * 4. GET /users/:id/balances?year=
   * Returns a specific user's leave balances and adjustment history.
   */
  async getUserBalances(orgId: string, userId: string, year?: number) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        orgId,
        role: { in: [Role.staff, Role.manager, Role.hr_admin] },
      },
      include: { organization: true },
    });

    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }

    const targetYear =
      year ??
      this.leaveYearService.leaveYearOf(
        new Date(),
        user.organization?.financialYearStartMonth ?? 4,
      );

    const balances = await this.prisma.leaveBalance.findMany({
      where: {
        orgId,
        userId,
        year: targetYear,
      },
      include: {
        leaveType: {
          select: {
            id: true,
            name: true,
            isWfh: true,
          },
        },
        balanceAdjustments: {
          orderBy: { createdAt: 'desc' },
          include: {
            actor: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
      orderBy: { leaveType: { name: 'asc' } },
    });

    const items = balances.map((b) => ({
      id: b.id,
      leaveTypeId: b.leaveTypeId,
      leaveTypeName: b.leaveType.name,
      year: b.year,
      allocated: b.allocated,
      used: b.used,
      pending: b.pending,
      available: b.allocated.minus(b.used).minus(b.pending),
      adjustments: b.balanceAdjustments,
    }));

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        department: user.department,
        role: user.role,
      },
      year: targetYear,
      balances: items,
    };
  }

  /**
   * 5. GET /me/balances?year=
   * Returns personal leave balances for all active leave types.
   * If a leave type has a monthlyLimit set (e.g. WFH), computes usedThisMonth from LeaveSegmentDays.
   */
  async getMyBalances(userId: string, orgId: string, year?: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { financialYearStartMonth: true },
    });

    const targetYear =
      year ??
      this.leaveYearService.leaveYearOf(
        new Date(),
        org?.financialYearStartMonth ?? 4,
      );

    // Active leave types in the organization
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { orgId, active: true },
      orderBy: { name: 'asc' },
    });

    // Existing balances for this user
    const balances = await this.prisma.leaveBalance.findMany({
      where: { orgId, userId, year: targetYear },
    });
    const balanceMap = new Map(balances.map((b) => [b.leaveTypeId, b]));

    // Date range for current calendar month in UTC
    const now = new Date();
    const currYear = now.getUTCFullYear();
    const currMonth = now.getUTCMonth(); // 0-indexed
    const startOfMonth = new Date(Date.UTC(currYear, currMonth, 1));
    const endOfMonth = new Date(Date.UTC(currYear, currMonth + 1, 0, 23, 59, 59, 999));

    // Counted weights for current month from LeaveSegmentDays (status pending or approved)
    const segmentDays = await this.prisma.leaveSegmentDay.findMany({
      where: {
        orgId,
        userId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
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
      select: {
        leaveTypeId: true,
        countedWeight: true,
      },
    });

    const usedThisMonthMap = new Map<string, Prisma.Decimal>();
    for (const day of segmentDays) {
      const current =
        usedThisMonthMap.get(day.leaveTypeId) ?? new Prisma.Decimal(0);
      usedThisMonthMap.set(day.leaveTypeId, current.plus(day.countedWeight));
    }

    const items = leaveTypes.map((lt) => {
      const b = balanceMap.get(lt.id);
      let allocated: Prisma.Decimal | null = null;
      let used: Prisma.Decimal | null = null;
      let pending: Prisma.Decimal | null = null;
      let available: Prisma.Decimal | null = null;

      if (lt.deductsBalance) {
        allocated = b ? b.allocated : new Prisma.Decimal(0);
        used = b ? b.used : new Prisma.Decimal(0);
        pending = b ? b.pending : new Prisma.Decimal(0);
        available = allocated.minus(used).minus(pending);
      }

      let monthlyLimit: Prisma.Decimal | null = null;
      let usedThisMonth: Prisma.Decimal | null = null;

      if (lt.monthlyLimit !== null) {
        monthlyLimit = lt.monthlyLimit;
        usedThisMonth =
          usedThisMonthMap.get(lt.id) ?? new Prisma.Decimal(0);
      }

      return {
        leaveTypeId: lt.id,
        leaveTypeName: lt.name,
        isWfh: lt.isWfh,
        deductsBalance: lt.deductsBalance,
        allocated,
        used,
        pending,
        available,
        monthlyLimit,
        usedThisMonth,
      };
    });

    return {
      year: targetYear,
      items,
    };
  }

  /**
   * 6. POST /balances/carry-forward/preview
   * Previews carry-forward amounts without modifying the database.
   */
  async previewCarryForward(orgId: string, fromYear: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { financialYearStartMonth: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const toYear = fromYear + 1;
    const range = this.leaveYearService.leaveYearRange(
      fromYear,
      org.financialYearStartMonth,
    );
    const yearEnded = new Date().getTime() > range.end.getTime();

    const existingRun = await this.prisma.carryForwardRun.findUnique({
      where: { orgId_fromYear: { orgId, fromYear } },
    });
    const alreadyRun = !!existingRun;

    const eligibleUsers = await this.prisma.user.findMany({
      where: {
        orgId,
        active: true,
        role: { in: [Role.staff, Role.manager, Role.hr_admin] },
      },
      select: { id: true, name: true },
    });

    const eligibleTypes = await this.prisma.leaveType.findMany({
      where: {
        orgId,
        active: true,
        deductsBalance: true,
        carryForwardMax: { gt: 0 },
      },
      select: { id: true, name: true, carryForwardMax: true },
    });

    const typeIds = eligibleTypes.map((t) => t.id);

    const [fromBalances, toBalances] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: {
          orgId,
          year: fromYear,
          leaveTypeId: { in: typeIds },
        },
      }),
      this.prisma.leaveBalance.findMany({
        where: {
          orgId,
          year: toYear,
          leaveTypeId: { in: typeIds },
        },
      }),
    ]);

    const fromMap = new Map(
      fromBalances.map((b) => [`${b.userId}_${b.leaveTypeId}`, b]),
    );
    const toMap = new Map(
      toBalances.map((b) => [`${b.userId}_${b.leaveTypeId}`, b]),
    );

    let pendingWarningCount = 0;
    const items: Array<{
      userId: string;
      name: string;
      leaveTypeId: string;
      typeName: string;
      available: string;
      carryForwardMax: string;
      carry: string;
      skippedReason?: string;
    }> = [];

    for (const user of eligibleUsers) {
      for (const lt of eligibleTypes) {
        const key = `${user.id}_${lt.id}`;
        const fromBal = fromMap.get(key);
        const toBal = toMap.get(key);

        let available = new Prisma.Decimal(0);
        if (fromBal) {
          available = fromBal.allocated
            .minus(fromBal.used)
            .minus(fromBal.pending);
          if (available.isNegative()) {
            available = new Prisma.Decimal(0);
          }
          if (fromBal.pending.greaterThan(0)) {
            pendingWarningCount++;
          }
        }

        const maxCarry = lt.carryForwardMax;
        const carry = Prisma.Decimal.min(maxCarry, available);

        let skippedReason: string | undefined;
        if (!toBal) {
          skippedReason = 'toYear allocation missing';
        }

        items.push({
          userId: user.id,
          name: user.name,
          leaveTypeId: lt.id,
          typeName: lt.name,
          available: available.toString(),
          carryForwardMax: maxCarry.toString(),
          carry: carry.toString(),
          skippedReason,
        });
      }
    }

    return {
      fromYear,
      toYear,
      yearEnded,
      alreadyRun,
      pendingWarningCount,
      items,
    };
  }

  /**
   * 7. POST /balances/carry-forward/run
   * Runs annual carry forward operation atomically.
   */
  async runCarryForward(actorId: string, orgId: string, fromYear: number) {
    const toYear = fromYear + 1;

    // 1. Check if already executed
    const existingRun = await this.prisma.carryForwardRun.findUnique({
      where: { orgId_fromYear: { orgId, fromYear } },
    });

    if (existingRun) {
      throw new ConflictException(
        `Carry-forward has already been executed for leave year ${fromYear}`,
      );
    }

    const eligibleUsers = await this.prisma.user.findMany({
      where: {
        orgId,
        active: true,
        role: { in: [Role.staff, Role.manager, Role.hr_admin] },
      },
      select: { id: true, name: true },
    });

    const eligibleTypes = await this.prisma.leaveType.findMany({
      where: {
        orgId,
        active: true,
        deductsBalance: true,
        carryForwardMax: { gt: 0 },
      },
      select: { id: true, name: true, carryForwardMax: true },
    });

    const typeIds = eligibleTypes.map((t) => t.id);

    const [fromBalances, toBalances] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: {
          orgId,
          year: fromYear,
          leaveTypeId: { in: typeIds },
        },
      }),
      this.prisma.leaveBalance.findMany({
        where: {
          orgId,
          year: toYear,
          leaveTypeId: { in: typeIds },
        },
      }),
    ]);

    const toMap = new Map(
      toBalances.map((b) => [`${b.userId}_${b.leaveTypeId}`, b]),
    );

    // 2. Validate that EVERY eligible user/type pair has a toYear balance row
    for (const user of eligibleUsers) {
      for (const lt of eligibleTypes) {
        const key = `${user.id}_${lt.id}`;
        if (!toMap.has(key)) {
          throw new ConflictException(
            'Pehle toYear ki allocation chalao: One or more eligible employees are missing balance rows for toYear',
          );
        }
      }
    }

    const fromMap = new Map(
      fromBalances.map((b) => [`${b.userId}_${b.leaveTypeId}`, b]),
    );

    let totalRows = 0;
    let totalDays = new Prisma.Decimal(0);

    await this.prisma.$transaction(async (tx) => {
      // Re-check lock / run existence inside transaction
      const runCheck = await tx.carryForwardRun.findUnique({
        where: { orgId_fromYear: { orgId, fromYear } },
      });
      if (runCheck) {
        throw new ConflictException(
          `Carry-forward has already been executed for leave year ${fromYear}`,
        );
      }

      for (const user of eligibleUsers) {
        for (const lt of eligibleTypes) {
          const key = `${user.id}_${lt.id}`;
          const fromBal = fromMap.get(key);
          const toBal = toMap.get(key)!;

          let available = new Prisma.Decimal(0);
          if (fromBal) {
            available = fromBal.allocated
              .minus(fromBal.used)
              .minus(fromBal.pending);
            if (available.isNegative()) {
              available = new Prisma.Decimal(0);
            }
          }

          const carry = Prisma.Decimal.min(lt.carryForwardMax, available);

          if (carry.greaterThan(0)) {
            await tx.leaveBalance.update({
              where: { id: toBal.id },
              data: {
                allocated: { increment: carry },
              },
            });

            await tx.balanceAdjustment.create({
              data: {
                orgId,
                balanceId: toBal.id,
                delta: carry,
                reason: `Carry-forward from ${fromYear}`,
                actorId,
              },
            });

            totalRows++;
            totalDays = totalDays.plus(carry);
          }
        }
      }

      await tx.carryForwardRun.create({
        data: {
          orgId,
          fromYear,
          runBy: actorId,
        },
      });
    });

    await this.auditService.log({
      orgId,
      actorId,
      action: AuditAction.CARRY_FORWARD_RUN,
      reason: `Carry forward executed from ${fromYear} to ${toYear}`,
      metadata: {
        fromYear,
        toYear,
        totalRows,
        totalDays: totalDays.toString(),
      },
    });

    return {
      message: 'Carry-forward executed successfully',
      fromYear,
      toYear,
      totalRows,
      totalDays,
    };
  }

  /**
   * Hook: Allocates balances for a newly created user (staff, manager, or hr_admin).
   * Called automatically after user creation.
   */
  async allocateForUser(userId: string, year?: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true },
    });

    if (!user || !user.active || !user.orgId || !user.organization) {
      return;
    }

    if (
      user.role !== Role.staff &&
      user.role !== Role.manager &&
      user.role !== Role.hr_admin
    ) {
      return;
    }

    const org = user.organization;
    const targetYear =
      year ??
      this.leaveYearService.leaveYearOf(
        new Date(),
        org.financialYearStartMonth,
      );

    const eligibleTypes = await this.prisma.leaveType.findMany({
      where: {
        orgId: org.id,
        active: true,
        deductsBalance: true,
        daysPerYear: { not: null },
      },
    });

    for (const lt of eligibleTypes) {
      const existing = await this.prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId,
            leaveTypeId: lt.id,
            year: targetYear,
          },
        },
      });

      if (!existing) {
        const prorated = this.leaveYearService.prorate(
          lt.daysPerYear!,
          user.joiningDate,
          targetYear,
          org.financialYearStartMonth,
        );

        if (prorated !== null) {
          await this.prisma.leaveBalance.create({
            data: {
              orgId: org.id,
              userId,
              leaveTypeId: lt.id,
              year: targetYear,
              allocated: prorated,
              used: new Prisma.Decimal(0),
              pending: new Prisma.Decimal(0),
            },
          });
        }
      }
    }
  }

  // ===========================================================================
  // BALANCE PRIMITIVES (Core Engine for Leave Requests)
  // All run inside an active transaction client with row-level atomic SQL updates
  // ===========================================================================

  /**
   * Reserves leave days by incrementing pending.
   * Atomically checks (allocated - used - pending) >= days.
   * Throws BadRequestException on insufficient balance, or NotFoundException if row does not exist.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    userId: string,
    leaveTypeId: string,
    year: number,
    days: Prisma.Decimal | number | string,
  ): Promise<LeaveBalance> {
    const daysDecimal = new Prisma.Decimal(days);

    const rows = await tx.$queryRaw<LeaveBalance[]>(Prisma.sql`
      UPDATE "LeaveBalance"
      SET "pending" = "pending" + ${daysDecimal},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "leaveTypeId" = ${leaveTypeId}
        AND "year" = ${year}
        AND ("allocated" - "used" - "pending") >= ${daysDecimal}
      RETURNING *;
    `);

    if (rows.length === 0) {
      const existing = await tx.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: { userId, leaveTypeId, year },
        },
      });

      if (!existing) {
        throw new NotFoundException('Leave balance not found');
      }

      throw new BadRequestException('Insufficient leave balance');
    }

    return rows[0];
  }

  /**
   * Releases reserved leave days by decrementing pending (conditional, no clamping).
   * Throws INVARIANT_VIOLATION if pending < days.
   */
  async release(
    tx: Prisma.TransactionClient,
    userId: string,
    leaveTypeId: string,
    year: number,
    days: Prisma.Decimal | number | string,
  ): Promise<LeaveBalance> {
    const daysDecimal = new Prisma.Decimal(days);

    const rows = await tx.$queryRaw<LeaveBalance[]>(Prisma.sql`
      UPDATE "LeaveBalance"
      SET "pending" = "pending" - ${daysDecimal},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "leaveTypeId" = ${leaveTypeId}
        AND "year" = ${year}
        AND "pending" >= ${daysDecimal}
      RETURNING *;
    `);

    if (rows.length === 0) {
      const existing = await tx.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: { userId, leaveTypeId, year },
        },
      });

      if (!existing) {
        throw new NotFoundException('Leave balance not found');
      }

      throw new BadRequestException(
        'INVARIANT_VIOLATION: Cannot release more than pending balance',
      );
    }

    return rows[0];
  }

  /**
   * Commits approved leave days: pending -= days, used += days (conditional, no clamping).
   * Throws INVARIANT_VIOLATION if pending < days.
   */
  async commit(
    tx: Prisma.TransactionClient,
    userId: string,
    leaveTypeId: string,
    year: number,
    days: Prisma.Decimal | number | string,
  ): Promise<LeaveBalance> {
    const daysDecimal = new Prisma.Decimal(days);

    const rows = await tx.$queryRaw<LeaveBalance[]>(Prisma.sql`
      UPDATE "LeaveBalance"
      SET "pending" = "pending" - ${daysDecimal},
          "used" = "used" + ${daysDecimal},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "leaveTypeId" = ${leaveTypeId}
        AND "year" = ${year}
        AND "pending" >= ${daysDecimal}
      RETURNING *;
    `);

    if (rows.length === 0) {
      const existing = await tx.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: { userId, leaveTypeId, year },
        },
      });

      if (!existing) {
        throw new NotFoundException('Leave balance not found');
      }

      throw new BadRequestException(
        'INVARIANT_VIOLATION: Cannot commit more than pending balance',
      );
    }

    return rows[0];
  }

  /**
   * Refunds cancelled leave days: used -= days (conditional, no clamping).
   * Throws INVARIANT_VIOLATION if used < days.
   */
  async refund(
    tx: Prisma.TransactionClient,
    userId: string,
    leaveTypeId: string,
    year: number,
    days: Prisma.Decimal | number | string,
  ): Promise<LeaveBalance> {
    const daysDecimal = new Prisma.Decimal(days);

    const rows = await tx.$queryRaw<LeaveBalance[]>(Prisma.sql`
      UPDATE "LeaveBalance"
      SET "used" = "used" - ${daysDecimal},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "leaveTypeId" = ${leaveTypeId}
        AND "year" = ${year}
        AND "used" >= ${daysDecimal}
      RETURNING *;
    `);

    if (rows.length === 0) {
      const existing = await tx.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: { userId, leaveTypeId, year },
        },
      });

      if (!existing) {
        throw new NotFoundException('Leave balance not found');
      }

      throw new BadRequestException(
        'INVARIANT_VIOLATION: Cannot refund more than used balance',
      );
    }

    return rows[0];
  }
}
