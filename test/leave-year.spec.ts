import { LeaveYearService } from '../src/balances/leave-year.service';
import { Prisma } from '@prisma/client';

describe('LeaveYearService (Unit Tests)', () => {
  let service: LeaveYearService;

  beforeEach(() => {
    service = new LeaveYearService();
  });

  describe('leaveYearOf', () => {
    it('handles financial year starting in April (startMonth = 4)', () => {
      // March 2027 belongs to leave year 2026
      expect(service.leaveYearOf('2027-03-31', 4)).toBe(2026);
      expect(service.leaveYearOf('2027-03-15', 4)).toBe(2026);

      // April 2027 belongs to leave year 2027
      expect(service.leaveYearOf('2027-04-01', 4)).toBe(2027);
      expect(service.leaveYearOf('2027-04-15', 4)).toBe(2027);
      expect(service.leaveYearOf('2027-12-31', 4)).toBe(2027);
      expect(service.leaveYearOf('2028-01-01', 4)).toBe(2027);
    });

    it('handles calendar year starting in January (startMonth = 1)', () => {
      expect(service.leaveYearOf('2026-01-01', 1)).toBe(2026);
      expect(service.leaveYearOf('2026-06-15', 1)).toBe(2026);
      expect(service.leaveYearOf('2026-12-31', 1)).toBe(2026);
      expect(service.leaveYearOf('2027-01-01', 1)).toBe(2027);
    });

    it('works with Date objects', () => {
      const marchDate = new Date('2027-03-10T00:00:00.000Z');
      expect(service.leaveYearOf(marchDate, 4)).toBe(2026);

      const aprilDate = new Date('2027-04-10T00:00:00.000Z');
      expect(service.leaveYearOf(aprilDate, 4)).toBe(2027);
    });
  });

  describe('leaveYearRange', () => {
    it('computes April start range (startMonth = 4)', () => {
      const range = service.leaveYearRange(2026, 4);
      expect(range.start.toISOString().split('T')[0]).toBe('2026-04-01');
      expect(range.end.toISOString().split('T')[0]).toBe('2027-03-31');
    });

    it('computes January start range (startMonth = 1)', () => {
      const range = service.leaveYearRange(2026, 1);
      expect(range.start.toISOString().split('T')[0]).toBe('2026-01-01');
      expect(range.end.toISOString().split('T')[0]).toBe('2026-12-31');
    });

    it('handles leap years correctly when financial year starts in March (end is Feb in leap year)', () => {
      // 2027 start in March -> ends February 2028 (2028 is a leap year with 29 days!)
      const range = service.leaveYearRange(2027, 3);
      expect(range.start.toISOString().split('T')[0]).toBe('2027-03-01');
      expect(range.end.toISOString().split('T')[0]).toBe('2028-02-29');
    });
  });

  describe('prorate', () => {
    const daysPerYear = new Prisma.Decimal(15);

    it('returns full allocation when joiningDate is null, undefined, or empty', () => {
      expect(service.prorate(daysPerYear, null, 2026, 4)).toEqual(daysPerYear);
      expect(service.prorate(daysPerYear, undefined, 2026, 4)).toEqual(daysPerYear);
      expect(service.prorate(daysPerYear, '', 2026, 4)).toEqual(daysPerYear);
    });

    it('returns full allocation when joining on or before leave year start', () => {
      // Joined exactly on start: 2026-04-01
      expect(service.prorate(daysPerYear, '2026-04-01', 2026, 4)).toEqual(daysPerYear);
      // Joined before start: 2026-02-15
      expect(service.prorate(daysPerYear, '2026-02-15', 2026, 4)).toEqual(daysPerYear);
      expect(service.prorate(daysPerYear, '2025-08-20', 2026, 4)).toEqual(daysPerYear);
    });

    it('returns null when joining date is after leave year end', () => {
      // Leave year 2026 ends on 2027-03-31
      expect(service.prorate(daysPerYear, '2027-04-01', 2026, 4)).toBeNull();
      expect(service.prorate(daysPerYear, '2027-05-15', 2026, 4)).toBeNull();
    });

    it('counts joining month if joining on or before 15th', () => {
      // Leave year: 2026 (Apr 2026 - Mar 2027), startMonth = 4.
      // Joining on 2026-04-15: day 15 <= 15 -> April counted -> 12 months remaining
      expect(service.prorate(daysPerYear, '2026-04-15', 2026, 4)).toEqual(daysPerYear);

      // Joining on 2026-10-15: Oct, Nov, Dec, Jan, Feb, Mar = 6 months
      // 15 * 6 / 12 = 7.5
      const resOct15 = service.prorate(daysPerYear, '2026-10-15', 2026, 4);
      expect(resOct15?.toNumber()).toBe(7.5);

      // Joining on 2027-03-15: March is month 12. 1 month remaining.
      // 15 * 1 / 12 = 1.25 -> rounds to nearest 0.5 (half-up) -> 1.5
      const resMar15 = service.prorate(daysPerYear, '2027-03-15', 2026, 4);
      expect(resMar15?.toNumber()).toBe(1.5);
    });

    it('does NOT count joining month if joining after 15th', () => {
      // Joining on 2026-04-16: April NOT counted -> 11 months (May - Mar)
      // 15 * 11 / 12 = 13.75 -> nearest 0.5 (half-up) is 14.0
      const resApr16 = service.prorate(daysPerYear, '2026-04-16', 2026, 4);
      expect(resApr16?.toNumber()).toBe(14.0);

      // Joining on 2026-10-16: Oct NOT counted -> 5 months (Nov - Mar)
      // 15 * 5 / 12 = 6.25 -> nearest 0.5 (half-up) is 6.5
      const resOct16 = service.prorate(daysPerYear, '2026-10-16', 2026, 4);
      expect(resOct16?.toNumber()).toBe(6.5);

      // Joining on 2027-03-16: March NOT counted -> 0 months remaining
      const resMar16 = service.prorate(daysPerYear, '2027-03-16', 2026, 4);
      expect(resMar16?.toNumber()).toBe(0.0);
    });

    it('rounds to nearest 0.5 (half-up) accurately', () => {
      // 10 days per year, 1 month remaining -> 10 * 1 / 12 = 0.833... -> 1.0
      expect(service.prorate(10, '2027-03-10', 2026, 4)?.toNumber()).toBe(1.0);

      // 14 days per year, 3 months remaining -> 14 * 3 / 12 = 3.5 -> 3.5
      expect(service.prorate(14, '2027-01-10', 2026, 4)?.toNumber()).toBe(3.5);

      // 18 days per year, 7 months remaining -> 18 * 7 / 12 = 10.5 -> 10.5
      expect(service.prorate(18, '2026-09-10', 2026, 4)?.toNumber()).toBe(10.5);
    });
  });
});
