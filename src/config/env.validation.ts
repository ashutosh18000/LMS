import { z } from 'zod';

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    DIRECT_URL: z.string().min(1).optional(),

    TEST_DATABASE_URL: z.string().optional(),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters long'),

    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),

    PORT: z
      .preprocess((val) => (val !== undefined ? Number(val) : 3000), z.number())
      .default(3000),

    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    CORS_ORIGINS: z.string().optional(),

    COOKIE_SAMESITE: z
      .enum(['strict', 'lax', 'none'])
      .default('strict'),

    COOKIE_DOMAIN: z.string().optional(),

    TRUST_PROXY: z.string().optional(),

    SWAGGER_ENABLED: z.string().optional(),

    PRISMA_TRANSACTION_MAX_WAIT: z
      .preprocess((val) => (val !== undefined ? Number(val) : 5000), z.number())
      .default(5000),

    PRISMA_TRANSACTION_TIMEOUT: z
      .preprocess((val) => (val !== undefined ? Number(val) : 10000), z.number())
      .default(10000),
  })
  .refine((data) => data.JWT_ACCESS_SECRET !== data.JWT_REFRESH_SECRET, {
    message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
    path: ['JWT_REFRESH_SECRET'],
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = (result.error as any).issues || (result.error as any).errors || [];
    const formattedErrors = issues
      .map((err: any) => `  - ${err.path?.join('.') || 'env'}: ${err.message}`)
      .join('\n');

    const errorMessage = `\n=======================================================\n❌ FATAL: Environment variable validation failed:\n${formattedErrors}\n=======================================================\n`;

    if (config.NODE_ENV === 'production') {
      console.error(errorMessage);
      process.exit(1);
    }

    throw new Error(errorMessage);
  }

  return result.data as EnvConfig;
}
