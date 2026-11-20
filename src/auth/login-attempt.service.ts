import { Injectable } from '@nestjs/common';

@Injectable()
export class LoginAttemptService {
  private readonly attempts = new Map<
    string,
    { count: number; firstAttempt: number }
  >();
  private readonly maxAttempts = 10;
  private readonly windowMs = 15 * 60 * 1000; // 15 minutes window

  private isThrottlingDisabled(): boolean {
    return process.env.THROTTLE_DISABLED !== undefined
      ? process.env.THROTTLE_DISABLED === 'true'
      : process.env.NODE_ENV === 'test';
  }

  isBlocked(email: string): { blocked: boolean; retryAfterSeconds: number } {
    if (this.isThrottlingDisabled()) {
      return { blocked: false, retryAfterSeconds: 0 };
    }

    const key = email.toLowerCase().trim();
    const record = this.attempts.get(key);
    if (!record) {
      return { blocked: false, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    if (now - record.firstAttempt > this.windowMs) {
      this.attempts.delete(key);
      return { blocked: false, retryAfterSeconds: 0 };
    }

    if (record.count >= this.maxAttempts) {
      const remainingMs = this.windowMs - (now - record.firstAttempt);
      return {
        blocked: true,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
      };
    }

    return { blocked: false, retryAfterSeconds: 0 };
  }

  recordFailedAttempt(email: string): void {
    if (this.isThrottlingDisabled()) {
      return;
    }

    const key = email.toLowerCase().trim();
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record || now - record.firstAttempt > this.windowMs) {
      this.attempts.set(key, { count: 1, firstAttempt: now });
    } else {
      record.count += 1;
    }
  }

  resetAttempts(email: string): void {
    const key = email.toLowerCase().trim();
    this.attempts.delete(key);
  }

  clearAll(): void {
    this.attempts.clear();
  }
}
