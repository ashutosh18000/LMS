import { HttpException, HttpStatus } from '@nestjs/common';

export class LeaveRequestException extends HttpException {
  public readonly code: string;
  public readonly details?: any;

  constructor(
    statusCode: HttpStatus,
    code: string,
    message: string,
    details?: any,
  ) {
    super(
      {
        statusCode,
        code,
        message,
        ...(details !== undefined && { details }),
      },
      statusCode,
    );
    this.code = code;
    this.details = details;
  }
}
