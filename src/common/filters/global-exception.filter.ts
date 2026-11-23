import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Response, Request } from 'express';
import * as crypto from 'crypto';

interface ErrorResponsePayload {
  statusCode: number;
  code: string;
  message: string;
  details?: any;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isProduction: boolean;

  constructor(configService?: ConfigService) {
    const nodeEnv = configService?.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
    this.isProduction = nodeEnv === 'production';
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId =
      (request.headers['x-request-id'] as string) ||
      (request as any).id ||
      crypto.randomUUID();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Internal server error';
    let details: any = null;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        code = this.deriveCodeFromStatus(statusCode);
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resObj = exceptionResponse as Record<string, any>;

        // Preserve custom code if provided (e.g., LeaveRequestException)
        code = resObj.code || this.deriveCodeFromStatus(statusCode);

        if (Array.isArray(resObj.message)) {
          // ValidationPipe errors: join array into string message and preserve details array
          message = resObj.message.join('; ');
          details = resObj.message;
        } else if (typeof resObj.message === 'string') {
          message = resObj.message;
          details = resObj.details !== undefined ? resObj.details : null;
        } else {
          message = resObj.error || exception.message || 'Error';
          details = resObj.details !== undefined ? resObj.details : null;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2028': {
          statusCode = HttpStatus.SERVICE_UNAVAILABLE;
          code = 'DB_TIMEOUT';
          message = 'Database operation timed out';
          break;
        }
        case 'P1001':
        case 'P1002': {
          statusCode = HttpStatus.SERVICE_UNAVAILABLE;
          code = 'DB_UNAVAILABLE';
          message = 'Database is temporarily unavailable';
          break;
        }
        case 'P2002': {
          statusCode = HttpStatus.CONFLICT;
          code = 'CONFLICT';
          const target = (exception.meta?.target as string[]) || [];
          message = target.length > 0
            ? `Duplicate value for unique field: ${target.join(', ')}`
            : 'Resource already exists with conflicting unique value';
          break;
        }
        case 'P2025': {
          statusCode = HttpStatus.NOT_FOUND;
          code = 'NOT_FOUND';
          message = (exception.meta?.cause as string) || 'Record not found';
          break;
        }
        case 'P2003': {
          statusCode = HttpStatus.BAD_REQUEST;
          code = 'FOREIGN_KEY_VIOLATION';
          message = 'Referenced entity does not exist or relation constraint violated';
          break;
        }
        default: {
          statusCode = HttpStatus.BAD_REQUEST;
          code = `DATABASE_ERROR_${exception.code}`;
          message = 'Database operation constraint violation';
          break;
        }
      }
    } else if (this.isDatabaseUnavailableError(exception)) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      code = 'DB_UNAVAILABLE';
      message = 'Database is temporarily unavailable';
    } else if (exception instanceof Error) {
      const errorId = crypto.randomUUID();
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      code = 'INTERNAL_SERVER_ERROR';
      message = 'An unexpected internal server error occurred';

      if (!this.isProduction) {
        details = {
          name: exception.name,
          message: exception.message,
          stack: exception.stack,
        };
      }

      this.logger.error(
        JSON.stringify({
          level: 'error',
          errorId,
          requestId,
          path: request.originalUrl || request.url,
          method: request.method,
          message: exception.message,
          ...(this.isProduction ? {} : { stack: exception.stack }),
        }),
      );
    }

    if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      if (!response.getHeader('Retry-After') && !response.getHeader('retry-after')) {
        const rawHeaders = (response.getHeaders ? response.getHeaders() : {}) as Record<string, any>;
        let retryVal = '60';
        for (const [k, v] of Object.entries(rawHeaders)) {
          if (k.toLowerCase().startsWith('retry-after')) {
            retryVal = String(v);
            break;
          }
        }
        response.setHeader('Retry-After', retryVal);
      }
    }

    const payload: ErrorResponsePayload = {
      statusCode,
      code,
      message,
      details: details !== undefined ? details : null,
    };

    if (!response.headersSent) {
      response.setHeader('x-request-id', requestId);
      response.status(statusCode).json(payload);
    }
  }

  private deriveCodeFromStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      default:
        return 'ERROR';
    }
  }

  private isDatabaseUnavailableError(
    exception: unknown,
  ): exception is Error & { errorCode?: string; code?: string } {
    if (!(exception instanceof Error)) return false;
    const error = exception as Error & { errorCode?: string; code?: string };
    return (
      error.errorCode === 'P1001' ||
      error.errorCode === 'P1002' ||
      error.code === 'P1001' ||
      error.code === 'P1002'
    );
  }
}
