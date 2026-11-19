import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();

    // 1. Assign or propagate x-request-id
    const incomingReqId = req.headers['x-request-id'];
    const requestId =
      typeof incomingReqId === 'string' && incomingReqId.trim().length > 0
        ? incomingReqId
        : crypto.randomUUID();

    (req as any).id = requestId;
    res.setHeader('x-request-id', requestId);

    // 2. Log when response finishes
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      const statusCode = res.statusCode;
      const user = (req as any).user;
      const userId = user?.userId || user?.id || null;

      const logPayload = {
        level: statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info',
        time: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.originalUrl || req.url,
        statusCode,
        durationMs,
        userId,
        ip: req.ip || req.socket?.remoteAddress,
      };

      // In test mode, keep stdout quiet unless error
      if (process.env.NODE_ENV === 'test' && statusCode < 500) {
        return;
      }

      const logLine = JSON.stringify(logPayload);
      if (statusCode >= 500) {
        this.logger.error(logLine);
      } else if (statusCode >= 400) {
        this.logger.warn(logLine);
      } else {
        this.logger.log(logLine);
      }
    });

    next();
  }
}
