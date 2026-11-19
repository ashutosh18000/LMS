export class DateUtil {
  /**
   * Parses YYYY-MM-DD string into a UTC midnight Date object.
   */
  static parse(dateStr: string): Date {
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
      throw new Error(`Invalid date string: ${dateStr}`);
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    return new Date(Date.UTC(year, month - 1, day));
  }

  /**
   * Formats a Date object into YYYY-MM-DD string using UTC components.
   */
  static format(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Returns calendar difference in days: dateA - dateB.
   * e.g., diffInDays('2026-11-15', '2026-11-10') = 5.
   */
  static diffInDays(dateAStr: string, dateBStr: string): number {
    const tA = this.parse(dateAStr).getTime();
    const tB = this.parse(dateBStr).getTime();
    return Math.round((tA - tB) / 86400000);
  }

  /**
   * Returns inclusive calendar span in days from startStr to endStr.
   * e.g., daysBetween('2026-11-13', '2026-11-17') = 5 days.
   */
  static daysBetween(startStr: string, endStr: string): number {
    return this.diffInDays(endStr, startStr) + 1;
  }

  /**
   * Adds calendar days to a date string.
   */
  static addDays(dateStr: string, days: number): string {
    const d = this.parse(dateStr);
    d.setUTCDate(d.getUTCDate() + days);
    return this.format(d);
  }

  /**
   * Returns an array of YYYY-MM-DD date strings from startStr to endStr inclusive.
   */
  static iterate(startStr: string, endStr: string): string[] {
    const result: string[] = [];
    const current = this.parse(startStr);
    const end = this.parse(endStr);

    while (current.getTime() <= end.getTime()) {
      result.push(this.format(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return result;
  }

  /**
   * Returns earliest date string from array.
   */
  static min(dates: string[]): string {
    return dates.slice().sort()[0];
  }

  /**
   * Returns latest date string from array.
   */
  static max(dates: string[]): string {
    return dates.slice().sort().reverse()[0];
  }
}
