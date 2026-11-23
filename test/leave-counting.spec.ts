import { Portion, RequestStatus, Role, SaturdayMode, SkipReason } from '@prisma/client';
import { LeaveRequestsService } from '../src/leave-requests/leave-requests.service';
import { LeaveYearService } from '../src/balances/leave-year.service';
import { ClockService } from '../src/common/services/clock.service';
import { DateUtil } from '../src/common/utils/date.util';
import { LeaveRequestException } from '../src/leave-requests/exceptions/leave-request.exception';

describe('Leave Counting & Breakdown Unit Tests (Pure Logic, No DB)', () => {
  let service: LeaveRequestsService;
  let mockPrisma: any;
  let mockResolver: any;
  let mockBalancesService: any;
  let leaveYearService: LeaveYearService;
  let clockService: ClockService;

  const orgId = 'org-1';
  const userId = 'user-1';

  beforeEach(() => {
    leaveYearService = new LeaveYearService();
    clockService = new ClockService();
    clockService.setFixedToday('2026-11-01');

    mockPrisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          id: orgId,
          timezone: 'Asia/Kolkata',
          financialYearStartMonth: 4,
          backdateAllowedDays: 7,
        }),
      },
      leaveType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'type-cl',
            orgId,
            name: 'Casual Leave',
            paid: true,
            deductsBalance: true,
            daysPerYear: 12,
            monthlyLimit: null,
            halfDayAllowed: true,
            minNoticeDays: 0,
            active: true,
          },
        ]),
      },
      holiday: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      leaveSegmentDay: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { countedWeight: null } }),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'bal-1',
          allocated: 12,
          used: 0,
          pending: 0,
        }),
      },
    };

    mockResolver = {
      resolveRange: jest.fn(),
    };

    mockBalancesService = {
      reserve: jest.fn(),
      commit: jest.fn(),
      release: jest.fn(),
      refund: jest.fn(),
    };

    const mockAuditService: any = {
      log: jest.fn(),
    };

    const mockNotificationsService: any = {
      createDecisionNotifications: jest.fn(),
      createCancellationNotifications: jest.fn(),
    };

    service = new LeaveRequestsService(
      mockPrisma,
      mockResolver,
      mockBalancesService,
      leaveYearService,
      clockService,
      mockAuditService,
      mockNotificationsService,
    );
  });

  it('1. Standard 5-day week: Fri 13 Nov to Tue 17 Nov gives countedDays = 3, spanDays = 5', async () => {
    // 13 Fri (work), 14 Sat (off), 15 Sun (off), 16 Mon (work), 17 Tue (work)
    mockResolver.resolveRange.mockResolvedValue(
      new Map([
        ['2026-11-13', { weeklyOff: false, weight: 1 }],
        ['2026-11-14', { weeklyOff: true, weight: 0 }],
        ['2026-11-15', { weeklyOff: true, weight: 0 }],
        ['2026-11-16', { weeklyOff: false, weight: 1 }],
        ['2026-11-17', { weeklyOff: false, weight: 1 }],
      ]),
    );

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Trip',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-13',
          endDate: '2026-11-17',
          portion: Portion.full,
        },
      ],
    });

    expect(res.spanDays).toBe(5);
    expect(res.countedDays).toBe(3);
    expect(res.breakdown).toHaveLength(5);

    const sat = res.breakdown.find((b) => b.date === '2026-11-14');
    expect(sat?.skipReason).toBe(SkipReason.weekly_off);
    expect(sat?.countedWeight).toBe(0);
    expect(sat?.occupancy).toBe(0);
  });

  it('2. Saturday-half schedule: Fri 13 Nov to Tue 17 Nov gives countedDays = 3.5', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([
        ['2026-11-13', { weeklyOff: false, weight: 1 }],
        ['2026-11-14', { weeklyOff: false, weight: 0.5 }], // Saturday half-day
        ['2026-11-15', { weeklyOff: true, weight: 0 }],
        ['2026-11-16', { weeklyOff: false, weight: 1 }],
        ['2026-11-17', { weeklyOff: false, weight: 1 }],
      ]),
    );

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Trip',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-13',
          endDate: '2026-11-17',
          portion: Portion.full,
        },
      ],
    });

    expect(res.spanDays).toBe(5);
    expect(res.countedDays).toBe(3.5);

    const sat = res.breakdown.find((b) => b.date === '2026-11-14');
    expect(sat?.skipReason).toBe(SkipReason.none);
    expect(sat?.countedWeight).toBe(0.5);
    expect(sat?.occupancy).toBe(1.0); // Full leave on Saturday-half
  });

  it('3. Alternate Saturday (1st & 3rd off): 14 Nov (2nd Saturday) is working -> countedDays = 4', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([
        ['2026-11-13', { weeklyOff: false, weight: 1 }],
        ['2026-11-14', { weeklyOff: false, weight: 1 }], // 2nd Sat is full working
        ['2026-11-15', { weeklyOff: true, weight: 0 }],
        ['2026-11-16', { weeklyOff: false, weight: 1 }],
        ['2026-11-17', { weeklyOff: false, weight: 1 }],
      ]),
    );

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Trip',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-13',
          endDate: '2026-11-17',
          portion: Portion.full,
        },
      ],
    });

    expect(res.spanDays).toBe(5);
    expect(res.countedDays).toBe(4);
  });

  it('4. Friday to Monday: countedDays = 2, spanDays = 4', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([
        ['2026-11-13', { weeklyOff: false, weight: 1 }],
        ['2026-11-14', { weeklyOff: true, weight: 0 }],
        ['2026-11-15', { weeklyOff: true, weight: 0 }],
        ['2026-11-16', { weeklyOff: false, weight: 1 }],
      ]),
    );

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Long weekend',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-13',
          endDate: '2026-11-16',
          portion: Portion.full,
        },
      ],
    });

    expect(res.spanDays).toBe(4);
    expect(res.countedDays).toBe(2);
  });

  it('5. Holiday in between is skipped (countedWeight = 0, skipReason = holiday)', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([
        ['2026-11-13', { weeklyOff: false, weight: 1 }],
        ['2026-11-14', { weeklyOff: true, weight: 0 }],
        ['2026-11-15', { weeklyOff: true, weight: 0 }],
        ['2026-11-16', { weeklyOff: false, weight: 1 }],
        ['2026-11-17', { weeklyOff: false, weight: 1 }],
      ]),
    );

    // Monday 16 Nov is a holiday
    mockPrisma.holiday.findMany.mockResolvedValue([
      { date: DateUtil.parse('2026-11-16'), name: 'Special Holiday', active: true },
    ]);

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Holiday trip',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-13',
          endDate: '2026-11-17',
          portion: Portion.full,
        },
      ],
    });

    expect(res.countedDays).toBe(2); // Fri and Tue only
    const mon = res.breakdown.find((b) => b.date === '2026-11-16');
    expect(mon?.skipReason).toBe(SkipReason.holiday);
    expect(mon?.occupancy).toBe(0);
    expect(mon?.countedWeight).toBe(0);
  });

  it('6. Monday first_half = 0.5', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([['2026-11-16', { weeklyOff: false, weight: 1 }]]),
    );

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Doctor appointment',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-16',
          endDate: '2026-11-16',
          portion: Portion.first_half,
        },
      ],
    });

    expect(res.spanDays).toBe(1);
    expect(res.countedDays).toBe(0.5);
    expect(res.breakdown[0].occupancy).toBe(0.5);
    expect(res.breakdown[0].countedWeight).toBe(0.5);
  });

  it('7. Half-day on weekly off throws ZERO_COUNTED_DAYS', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([['2026-11-15', { weeklyOff: true, weight: 0 }]]), // Sunday
    );

    let caughtError: any;
    try {
      await service.previewLeaveRequest(userId, orgId, Role.staff, {
        reason: 'Sunday leave',
        segments: [
          {
            leaveTypeId: 'type-cl',
            startDate: '2026-11-15',
            endDate: '2026-11-15',
            portion: Portion.first_half,
          },
        ],
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(LeaveRequestException);
    expect(caughtError.code).toBe('ZERO_COUNTED_DAYS');
  });

  it('8. Saturday-half schedule with full leave: occupancy = 1, countedWeight = 0.5', async () => {
    mockResolver.resolveRange.mockResolvedValue(
      new Map([['2026-11-14', { weeklyOff: false, weight: 0.5 }]]),
    );

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Saturday full leave',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2026-11-14',
          endDate: '2026-11-14',
          portion: Portion.full,
        },
      ],
    });

    expect(res.breakdown[0].occupancy).toBe(1.0);
    expect(res.breakdown[0].countedWeight).toBe(0.5);
    expect(res.countedDays).toBe(0.5);
  });

  it('9. Boundary of leave year (31 Mar / 1 Apr with April FY): splits into two distinct leave years', async () => {
    clockService.setFixedToday('2027-03-01');

    mockResolver.resolveRange.mockResolvedValue(
      new Map([
        ['2027-03-31', { weeklyOff: false, weight: 1 }],
        ['2027-04-01', { weeklyOff: false, weight: 1 }],
      ]),
    );

    // Verify leave year calculation
    expect(leaveYearService.leaveYearOf('2027-03-31', 4)).toBe(2026);
    expect(leaveYearService.leaveYearOf('2027-04-01', 4)).toBe(2027);

    const res = await service.previewLeaveRequest(userId, orgId, Role.staff, {
      reason: 'Year end transition',
      segments: [
        {
          leaveTypeId: 'type-cl',
          startDate: '2027-03-31',
          endDate: '2027-04-01',
          portion: Portion.full,
        },
      ],
    });

    expect(res.spanDays).toBe(2);
    expect(res.countedDays).toBe(2);
    expect(res.breakdown).toHaveLength(2);
  });
});
