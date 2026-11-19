import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // In test environment, bypass rate-limiting so end-to-end tests run reliably
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    return super.canActivate(context);
  }
}
