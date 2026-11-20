import { z } from 'zod';

export const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    DIRECT_URL: z.string().min(1).optional(),

    TEST_DATABASE_URL: z.string().optional(),

    TEST_DIRECT_URL: z.string().optional(),

    DATABASE_URL_UNPOOLED: z.string().optional(),

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

    COOKIE_SECURE: z
      .preprocess((val) => {
        if (val === 'false' || val === false) return false;
        if (val === 'true' || val === true) return true;
        return undefined;
      }, z.boolean().optional()),

    TRUST_PROXY: z.string().optional(),

    THROTTLE_DISABLED: z.string().optional(),

    SWAGGER_ENABLED: z.string().optional(),

    PRISMA_TRANSACTION_MAX_WAIT: z
      .preprocess((val) => (val !== undefined ? Number(val) : 5000), z.number())
      .default(5000),

    PRISMA_TRANSACTION_TIMEOUT: z
      .preprocess((val) => (val !== undefined ? Number(val) : 10000), z.number())
      .default(10000),
  })
  .superRefine((data, ctx) => {
    // 1. Secrets must be distinct
    if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
        path: ['JWT_REFRESH_SECRET'],
      });
    }

    // 2. DIRECT_URL must be an unpooled direct connection (never contain -pooler)
    if (data.DIRECT_URL && data.DIRECT_URL.trim() !== '') {
      try {
        const url = new URL(data.DIRECT_URL);
        if (url.hostname.includes('-pooler')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'DIRECT_URL must be a direct unpooled connection and cannot contain "-pooler"',
            path: ['DIRECT_URL'],
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DIRECT_URL must be a valid URL',
          path: ['DIRECT_URL'],
        });
      }
    }

    // 3. Strict production rules
    if (data.NODE_ENV === 'production') {
      // DIRECT_URL is strictly required in production
      if (!data.DIRECT_URL || data.DIRECT_URL.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DIRECT_URL is required in production',
          path: ['DIRECT_URL'],
        });
      }

      // CORS_ORIGINS is strictly required, cannot contain '*', and each must be a valid URL
      if (!data.CORS_ORIGINS || data.CORS_ORIGINS.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ORIGINS is required in production',
          path: ['CORS_ORIGINS'],
        });
      } else {
        if (data.CORS_ORIGINS.includes('*')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'CORS_ORIGINS cannot contain "*" in production',
            path: ['CORS_ORIGINS'],
          });
        }

        const origins = data.CORS_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean);

        if (origins.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'CORS_ORIGINS is required in production',
            path: ['CORS_ORIGINS'],
          });
        }

        for (const origin of origins) {
          try {
            const parsed = new URL(origin);
            if (!parsed.protocol.startsWith('http')) {
              throw new Error();
            }
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Invalid origin URL in CORS_ORIGINS: "${origin}"`,
              path: ['CORS_ORIGINS'],
            });
          }
        }
      }

      // COOKIE_SAMESITE=none requires secure cookie in production
      if (data.COOKIE_SAMESITE === 'none') {
        if (data.COOKIE_SECURE === false) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'COOKIE_SECURE must be true when COOKIE_SAMESITE is none in production',
            path: ['COOKIE_SECURE'],
          });
        }
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues =
      (result.error as any).issues || (result.error as any).errors || [];
    const formattedErrors = issues
      .map((err: any) => `  - ${err.path?.join('.') || 'env'}: ${err.message}`)
      .join('\n');

    const errorMessage = `\n=======================================================\n❌ FATAL: Environment variable validation failed:\n${formattedErrors}\n=======================================================\n`;

    if (
      config.NODE_ENV === 'production' &&
      !process.env.JEST_WORKER_ID &&
      process.env.NODE_ENV !== 'test'
    ) {
      console.error(errorMessage);
      process.exit(1);
    }

    throw new Error(errorMessage);
  }

  // Startup warnings
  if (result.data.DATABASE_URL) {
    try {
      const dbUrl = new URL(result.data.DATABASE_URL);
      if (dbUrl.hostname.includes('-pooler')) {
        const pgbouncer = dbUrl.searchParams.get('pgbouncer');
        if (pgbouncer !== 'true') {
          console.warn(
            '⚠️ WARNING: DATABASE_URL uses a connection pooler host (-pooler) but pgbouncer=true is missing in query parameters. Transactions may fail or behave unpredictably.',
          );
        }
      }
    } catch {
      // Handled by schema
    }
  }

  if (result.data.COOKIE_SAMESITE === 'none') {
    console.warn(
      '⚠️ WARNING: COOKIE_SAMESITE is set to "none". Ensure HTTPS is used and third-party cookie restrictions (Safari ITP) are handled.',
    );
  }

  return result.data as EnvConfig;
}
