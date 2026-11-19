import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
  }

  /**
   * Connect to PostgreSQL with retry mechanism.
   * Useful for serverless databases like Neon where the compute endpoint
   * may be idle/sleeping and requires a wake-up time.
   */
  private async connectWithRetry(maxRetries = 3, delayMs = 2000): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Successfully connected to the database.');
        return;
      } catch (error) {
        this.logger.warn(
          `Database connection attempt ${attempt}/${maxRetries} failed: ${
            error instanceof Error ? error.message : error
          }`,
        );
        if (attempt === maxRetries) {
          this.logger.error(
            'Failed to connect to the database after maximum retries.',
          );
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from the database.');
  }
}
