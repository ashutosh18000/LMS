import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isTest = process.env.NODE_ENV === 'test';
    const throttleDisabled =
      process.env.THROTTLE_DISABLED !== undefined
        ? process.env.THROTTLE_DISABLED === 'true'
        : isTest;

    if (throttleDisabled) {
      return true;
    }
    return super.canActivate(context);
  }

  async handleRequest(requestProps: any): Promise<boolean> {
    const { context, throttler } = requestProps;
    const handler = context.getHandler();
    const classRef = context.getClass();

    // If this is a specialized named throttler (not 'default'), only run if explicitly targeted on route or controller
    if (throttler.name !== 'default') {
      const hasNamedLimit = this.reflector.getAllAndOverride(
        `THROTTLER:LIMIT${throttler.name}`,
        [handler, classRef],
      );
      if (hasNamedLimit === undefined) {
        return true;
      }
    }

    return super.handleRequest(requestProps);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: any,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    if (res && typeof res.setHeader === 'function') {
      const retryAfter =
        throttlerLimitDetail?.timeToBlockExpire ||
        throttlerLimitDetail?.timeToExpire ||
        60;
      res.setHeader('Retry-After', String(retryAfter));
    }
    await super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
