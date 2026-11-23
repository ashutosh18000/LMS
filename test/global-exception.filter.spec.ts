import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

describe('GlobalExceptionFilter database availability errors', () => {
  const filter = new GlobalExceptionFilter();

  function invokeFilter(exception: unknown) {
    const response = {
      headersSent: false,
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      getHeaders: jest.fn(() => ({})),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      headers: {},
      url: '/test',
      originalUrl: '/test',
      method: 'GET',
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return response;
  }

  it('maps Prisma transaction timeout P2028 to 503 DB_TIMEOUT', () => {
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Transaction timed out',
      { code: 'P2028', clientVersion: 'test' },
    );
    const response = invokeFilter(exception);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, code: 'DB_TIMEOUT' }),
    );
  });

  it.each(['P1001', 'P1002'])('maps Prisma connection error %s to 503 DB_UNAVAILABLE', (errorCode) => {
    const exception = Object.assign(new Error('Database connection failed'), { errorCode });
    const response = invokeFilter(exception);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, code: 'DB_UNAVAILABLE' }),
    );
  });
});
