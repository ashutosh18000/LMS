import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface LeaveYearRange {
  start: Date;
  end: Date;
}

@Injectable()
export class LeaveYearService {
  /**
   * Returns the leave year number for a given calendar date and organization financialYearStartMonth.
   * If startMonth is 1, it matches the calendar year.
   * If startMonth > 1, dates before startMonth belong to (year - 1).
   */
  leaveYearOf(date: Date | string, startMonth: number): number {
    let year: number;
    let month: number;

    if (typeof date === 'string') {
      const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
      } else {
        const d = new Date(date);
        year = d.getUTCFullYear();
        month = d.getUTCMonth() + 1;
      }
    } else {
      year = date.getUTCFullYear();
      month = date.getUTCMonth() + 1;
    }

    if (month >= startMonth) {
      return year;
    }
    return year - 1;
  }

  /**
   * Returns the plain calendar inclusive start and end dates for a leave year.
   * - start: 1st day of startMonth in year (at UTC midnight)
   * - end: last day of the 12th month in year / year + 1 (at UTC midnight)
   */
  leaveYearRange(year: number, startMonth: number): LeaveYearRange {
    const start = new Date(Date.UTC(year, startMonth - 1, 1));

    let end: Date;
    if (startMonth === 1) {
      end = new Date(Date.UTC(year, 11, 31));
    } else {
      const endYear = year + 1;
      const endMonth = startMonth - 1;
      // Day 0 of next month in UTC gives the last calendar day of endMonth
      end = new Date(Date.UTC(endYear, endMonth, 0));
    }

    return { start, end };
  }

  /**
   * Prorates annual leave quota for employees based on their joining date:
   * - If joiningDate is empty/null/undefined -> full daysPerYear.
   * - If joiningDate <= leaveYear.start -> full daysPerYear.
   * - If joiningDate > leaveYear.end -> null (no allocation for this year).
   * - If joiningDate is within leaveYear:
   *     - Joining on or before day 15: joining month is counted.
   *     - Joining after day 15: joining month is NOT counted.
   *     - allocation = daysPerYear * remainingMonths / 12, rounded to nearest 0.5 (half up).
   */
  prorate(
    daysPerYear: Prisma.Decimal | number | string,
    joiningDate: Date | string | null | undefined,
    year: number,
    startMonth: number,
  ): Prisma.Decimal | null {
    const totalDays = new Prisma.Decimal(daysPerYear);

    if (!joiningDate) {
      return totalDays;
    }

    let joinYear: number;
    let joinMonth: number;
    let joinDay: number;

    if (typeof joiningDate === 'string') {
      const match = joiningDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        joinYear = parseInt(match[1], 10);
        joinMonth = parseInt(match[2], 10);
        joinDay = parseInt(match[3], 10);
      } else {
        const d = new Date(joiningDate);
        joinYear = d.getUTCFullYear();
        joinMonth = d.getUTCMonth() + 1;
        joinDay = d.getUTCDate();
      }
    } else {
      joinYear = joiningDate.getUTCFullYear();
      joinMonth = joiningDate.getUTCMonth() + 1;
      joinDay = joiningDate.getUTCDate();
    }

    const joinDateObj = new Date(Date.UTC(joinYear, joinMonth - 1, joinDay));
    const { start, end } = this.leaveYearRange(year, startMonth);

    if (joinDateObj.getTime() <= start.getTime()) {
      return totalDays;
    }

    if (joinDateObj.getTime() > end.getTime()) {
      return null;
    }

    // Number of months elapsed in the leave year before the joining month
    let elapsedMonths: number;
    if (joinMonth >= startMonth) {
      elapsedMonths = joinMonth - startMonth;
    } else {
      elapsedMonths = 12 - startMonth + joinMonth;
    }

    // Determine remaining months in the leave year
    let remainingMonths: number;
    if (joinDay <= 15) {
      // Joining month is counted
      remainingMonths = 12 - elapsedMonths;
    } else {
      // Joining month is not counted
      remainingMonths = 11 - elapsedMonths;
    }

    if (remainingMonths <= 0) {
      return new Prisma.Decimal(0);
    }
    if (remainingMonths >= 12) {
      return totalDays;
    }

    // Decimal arithmetic using tenths and rounding to nearest 0.5 (half-up)
    // 0.5 days = 5 tenths.
    // D: tenths of daysPerYear (e.g., 15.0 days -> 150 tenths)
    const D = Math.round(Number(totalDays) * 10);
    const numerator = D * remainingMonths;

    // Nearest multiple of 5 tenths (half up):
    // unitsOfFiveTenths = floor((numerator + 30) / 60)
    const unitsOfFiveTenths = Math.floor((numerator + 30) / 60);
    const finalTenths = unitsOfFiveTenths * 5;

    return new Prisma.Decimal(finalTenths).dividedBy(10);
  }
}
