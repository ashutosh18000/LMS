import { PrismaService } from '../src/prisma/prisma.service';

describe('PrismaService $transaction Override (Unit Tests)', () => {
  let prismaService: PrismaService;

  beforeEach(() => {
    process.env.PRISMA_TRANSACTION_MAX_WAIT = '4000';
    process.env.PRISMA_TRANSACTION_TIMEOUT = '8000';
    prismaService = new PrismaService();
  });

  afterEach(() => {
    delete process.env.PRISMA_TRANSACTION_MAX_WAIT;
    delete process.env.PRISMA_TRANSACTION_TIMEOUT;
  });

  it('executes interactive callback form and merges default transaction options', async () => {
    const superTransactionSpy = jest
      .spyOn(Object.getPrototypeOf(PrismaService.prototype), '$transaction')
      .mockImplementation(async (arg: any, options?: any) => {
        if (typeof arg === 'function') {
          return arg({ mockTx: true });
        }
        return arg;
      });

    const callback = async (tx: any) => {
      return { success: true, tx };
    };

    const result = await prismaService.$transaction(callback);

    expect(result).toEqual({ success: true, tx: { mockTx: true } });
    expect(superTransactionSpy).toHaveBeenCalledWith(
      callback,
      expect.objectContaining({
        maxWait: 4000,
        timeout: 8000,
      }),
    );

    superTransactionSpy.mockRestore();
  });

  it('preserves caller-specified explicit timeout and maxWait without overriding them', async () => {
    const superTransactionSpy = jest
      .spyOn(Object.getPrototypeOf(PrismaService.prototype), '$transaction')
      .mockImplementation(async (arg: any, options?: any) => {
        if (typeof arg === 'function') {
          return arg({ mockTx: true });
        }
        return arg;
      });

    const callback = async (tx: any) => 'result';
    const callerOptions = { maxWait: 15000, timeout: 30000 };

    await prismaService.$transaction(callback, callerOptions);

    expect(superTransactionSpy).toHaveBeenCalledWith(
      callback,
      expect.objectContaining({
        maxWait: 15000,
        timeout: 30000,
      }),
    );

    superTransactionSpy.mockRestore();
  });

  it('executes sequential array form without callback-specific option merging', async () => {
    const mockArray = [{ promise: 1 }, { promise: 2 }] as any;
    const superTransactionSpy = jest
      .spyOn(Object.getPrototypeOf(PrismaService.prototype), '$transaction')
      .mockImplementation(async (arg: any, options?: any) => ['res1', 'res2']);

    const result = await prismaService.$transaction(mockArray);

    expect(result).toEqual(['res1', 'res2']);
    expect(superTransactionSpy).toHaveBeenCalledWith(mockArray, undefined);

    superTransactionSpy.mockRestore();
  });
});
