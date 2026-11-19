import { SaturdayMode } from '@prisma/client';
import { ScheduleResolverService } from '../src/schedules/schedule-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('ScheduleResolverService (Unit Tests)', () => {
  let resolver: ScheduleResolverService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      employeeSchedule: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      organization: {
        findUnique: jest.fn(),
      },
    };
    resolver = new ScheduleResolverService(mockPrisma as PrismaService);
  });

  describe('Sunday Rule', () => {
    it('always marks Sunday as off with weight 0 regardless of template', async () => {
      // 2026-05-03 is Sunday
      const res = await resolver.resolveDay('user-1', '2026-05-03');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
      expect(res.reason).toBe('Sunday off');
      // Prisma should not even be queried because Sunday rule is evaluated first
      expect(mockPrisma.employeeSchedule.findFirst).not.toHaveBeenCalled();
    });

    it('works when passed a Date object for Sunday', async () => {
      const sunday = new Date('2026-05-10T00:00:00.000Z');
      const res = await resolver.resolveDay('user-1', sunday);
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });
  });

  describe('Organization workingDays Fallback (No assigned schedule)', () => {
    beforeEach(() => {
      mockPrisma.employeeSchedule.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        organization: {
          workingDays: [1, 2, 3, 4, 5], // Mon-Fri
        },
      });
    });

    it('resolves Monday as working day with weight 1', async () => {
      // 2026-05-04 is Monday
      const res = await resolver.resolveDay('user-1', '2026-05-04');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });

    it('resolves Saturday as weekly off with weight 0 under standard 5-day org', async () => {
      // 2026-05-02 is Saturday
      const res = await resolver.resolveDay('user-1', '2026-05-02');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });

    it('resolves Sunday as off with weight 0', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-03');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });
  });

  describe('Assigned WorkScheduleTemplate - Saturday Modes', () => {
    it('resolves Saturday as off with weight 0 when saturdayMode is off', async () => {
      mockPrisma.employeeSchedule.findFirst.mockResolvedValue({
        userId: 'user-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        template: {
          saturdayMode: SaturdayMode.off,
          alternateOffWeeks: [],
        },
      });

      // 2026-05-02 is Saturday
      const sat = await resolver.resolveDay('user-1', '2026-05-02');
      expect(sat.isWorkDay).toBe(false);
      expect(sat.weight).toBe(0);

      // Weekday Monday 2026-05-04 should still be full day
      const mon = await resolver.resolveDay('user-1', '2026-05-04');
      expect(mon.isWorkDay).toBe(true);
      expect(mon.weight).toBe(1);
    });

    it('resolves Saturday as half day with weight 0.5 when saturdayMode is half', async () => {
      mockPrisma.employeeSchedule.findFirst.mockResolvedValue({
        userId: 'user-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        template: {
          saturdayMode: SaturdayMode.half,
          alternateOffWeeks: [],
        },
      });

      const sat = await resolver.resolveDay('user-1', '2026-05-02');
      expect(sat.isWorkDay).toBe(true);
      expect(sat.weight).toBe(0.5);
      expect(sat.reason).toBe('Saturday half day');
    });

    it('resolves Saturday as full day with weight 1.0 when saturdayMode is full', async () => {
      mockPrisma.employeeSchedule.findFirst.mockResolvedValue({
        userId: 'user-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        template: {
          saturdayMode: SaturdayMode.full,
          alternateOffWeeks: [],
        },
      });

      const sat = await resolver.resolveDay('user-1', '2026-05-02');
      expect(sat.isWorkDay).toBe(true);
      expect(sat.weight).toBe(1);
    });
  });

  describe('Alternate Saturday Calculation [1, 3] in May 2026', () => {
    beforeEach(() => {
      mockPrisma.employeeSchedule.findFirst.mockResolvedValue({
        userId: 'user-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        template: {
          saturdayMode: SaturdayMode.alternate,
          alternateOffWeeks: [1, 3],
        },
      });
    });

    it('1st Saturday (May 2): OFF (weight 0)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-02');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });

    it('2nd Saturday (May 9): WORKING (weight 1)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-09');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });

    it('3rd Saturday (May 16): OFF (weight 0)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-16');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });

    it('4th Saturday (May 23): WORKING (weight 1)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-23');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });

    it('5th Saturday (May 30): WORKING (weight 1) because 5 is not in [1, 3]', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-30');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });
  });

  describe('Alternate Saturday Calculation [2, 4] in May 2026', () => {
    beforeEach(() => {
      mockPrisma.employeeSchedule.findFirst.mockResolvedValue({
        userId: 'user-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        template: {
          saturdayMode: SaturdayMode.alternate,
          alternateOffWeeks: [2, 4],
        },
      });
    });

    it('1st Saturday (May 2): WORKING (weight 1)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-02');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });

    it('2nd Saturday (May 9): OFF (weight 0)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-09');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });

    it('3rd Saturday (May 16): WORKING (weight 1)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-16');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });

    it('4th Saturday (May 23): OFF (weight 0)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-23');
      expect(res.isWorkDay).toBe(false);
      expect(res.weight).toBe(0);
    });

    it('5th Saturday (May 30): WORKING (weight 1)', async () => {
      const res = await resolver.resolveDay('user-1', '2026-05-30');
      expect(res.isWorkDay).toBe(true);
      expect(res.weight).toBe(1);
    });
  });

  describe('Schedule Transition Over Time', () => {
    it('uses latest effective schedule on or before target date', async () => {
      const olderSchedule = {
        userId: 'user-1',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        template: { saturdayMode: SaturdayMode.off, alternateOffWeeks: [] },
      };
      const newerSchedule = {
        userId: 'user-1',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        template: { saturdayMode: SaturdayMode.full, alternateOffWeeks: [] },
      };

      // Mock DB behavior: returns matching schedule with effectiveFrom <= date
      mockPrisma.employeeSchedule.findFirst.mockImplementation(
        ({ where }: any) => {
          const lteDate = where.effectiveFrom.lte;
          if (lteDate >= newerSchedule.effectiveFrom) {
            return Promise.resolve(newerSchedule);
          }
          if (lteDate >= olderSchedule.effectiveFrom) {
            return Promise.resolve(olderSchedule);
          }
          return Promise.resolve(null);
        },
      );

      // Date in May 2026 (before transition) -> Saturday should be off (weight 0)
      const maySat = await resolver.resolveDay('user-1', '2026-05-02');
      expect(maySat.isWorkDay).toBe(false);
      expect(maySat.weight).toBe(0);

      // Date in June 2026 (after transition) -> Saturday should be full (weight 1)
      const juneSat = await resolver.resolveDay('user-1', '2026-06-06');
      expect(juneSat.isWorkDay).toBe(true);
      expect(juneSat.weight).toBe(1);
    });
  });

  describe('resolveRange (Date Span Resolution)', () => {
    it('resolves a 5-day span with standard working days fallback', async () => {
      mockPrisma.employeeSchedule.findMany.mockResolvedValue([]);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        organization: { workingDays: [1, 2, 3, 4, 5] },
      });

      // 2026-11-13 (Fri) to 2026-11-17 (Tue)
      const rangeMap = await resolver.resolveRange('user-1', '2026-11-13', '2026-11-17');

      expect(rangeMap.size).toBe(5);
      expect(rangeMap.get('2026-11-13')).toEqual({ weeklyOff: false, weight: 1 });
      expect(rangeMap.get('2026-11-14')).toEqual({ weeklyOff: true, weight: 0 }); // Sat
      expect(rangeMap.get('2026-11-15')).toEqual({ weeklyOff: true, weight: 0 }); // Sun
      expect(rangeMap.get('2026-11-16')).toEqual({ weeklyOff: false, weight: 1 });
      expect(rangeMap.get('2026-11-17')).toEqual({ weeklyOff: false, weight: 1 });
    });

    it('resolves range using preloaded working days without querying user', async () => {
      mockPrisma.employeeSchedule.findMany.mockResolvedValue([]);

      const rangeMap = await resolver.resolveRange(
        'user-1',
        '2026-11-13',
        '2026-11-15',
        undefined,
        [1, 2, 3, 4, 5],
      );

      expect(rangeMap.size).toBe(3);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(rangeMap.get('2026-11-13')?.weight).toBe(1);
      expect(rangeMap.get('2026-11-14')?.weight).toBe(0);
      expect(rangeMap.get('2026-11-15')?.weight).toBe(0);
    });
  });

  describe('resolveRangeForUsers (Batch Date Span Resolution)', () => {
    it('returns empty Map when passed empty userIds array without querying database', async () => {
      const res = await resolver.resolveRangeForUsers('org-1', [], '2026-11-01', '2026-11-05');
      expect(res.size).toBe(0);
      expect(mockPrisma.employeeSchedule.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.organization.findUnique).not.toHaveBeenCalled();
    });

    it('batch resolves schedules for multiple users with different templates in a single query', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        workingDays: [1, 2, 3, 4, 5],
      });

      // User 1: Saturday off
      // User 2: Saturday half
      mockPrisma.employeeSchedule.findMany.mockResolvedValue([
        {
          userId: 'user-1',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          template: { saturdayMode: SaturdayMode.off, alternateOffWeeks: [] },
        },
        {
          userId: 'user-2',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          template: { saturdayMode: SaturdayMode.half, alternateOffWeeks: [] },
        },
      ]);

      // 2026-11-06 (Fri) to 2026-11-08 (Sun)
      const res = await resolver.resolveRangeForUsers(
        'org-1',
        ['user-1', 'user-2', 'user-3'], // user-3 has no assigned schedule (fallback)
        '2026-11-06',
        '2026-11-08',
      );

      // Exactly 1 query for organization and 1 query for employeeSchedule
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrisma.employeeSchedule.findMany).toHaveBeenCalledTimes(1);

      expect(res.size).toBe(3);

      // User 1 (Sat off)
      const u1 = res.get('user-1')!;
      expect(u1.get('2026-11-06')).toEqual({ weeklyOff: false, weight: 1 });
      expect(u1.get('2026-11-07')).toEqual({ weeklyOff: true, weight: 0 }); // Sat
      expect(u1.get('2026-11-08')).toEqual({ weeklyOff: true, weight: 0 }); // Sun

      // User 2 (Sat half)
      const u2 = res.get('user-2')!;
      expect(u2.get('2026-11-06')).toEqual({ weeklyOff: false, weight: 1 });
      expect(u2.get('2026-11-07')).toEqual({ weeklyOff: false, weight: 0.5 }); // Sat
      expect(u2.get('2026-11-08')).toEqual({ weeklyOff: true, weight: 0 }); // Sun

      // User 3 (Fallback: Mon-Fri working, Sat-Sun off)
      const u3 = res.get('user-3')!;
      expect(u3.get('2026-11-06')).toEqual({ weeklyOff: false, weight: 1 });
      expect(u3.get('2026-11-07')).toEqual({ weeklyOff: true, weight: 0 });
      expect(u3.get('2026-11-08')).toEqual({ weeklyOff: true, weight: 0 });
    });
  });
});
