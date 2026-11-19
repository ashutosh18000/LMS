import { Injectable } from '@nestjs/common';

@Injectable()
export class ClockService {
  private fixedToday: string | null = null;

  /**
   * Overrides "today" for deterministic unit and E2E testing.
   * Only allowed when NODE_ENV === 'test'.
   * Pass null to restore real-time clock.
   */
  setFixedToday(dateStr: string | null): void {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('setFixedToday is only allowed in test environment');
    }
    this.fixedToday = dateStr;
  }

  /**
   * Returns today's plain calendar date string (YYYY-MM-DD) in the specified time zone.
   */
  today(timeZone = 'Asia/Kolkata'): string {
    if (this.fixedToday) {
      return this.fixedToday;
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date());
    } catch {
      // Fallback if timezone string is invalid
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return formatter.format(new Date());
    }
  }
}
