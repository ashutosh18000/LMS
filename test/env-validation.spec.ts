import { validateEnv } from '../src/config/env.validation';

describe('Environment Validation (Unit Tests)', () => {
  const validDevConfig = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    DIRECT_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-chars-long!',
    JWT_REFRESH_SECRET: 'refresh-secret-that-is-different-and-32-chars!',
    PORT: '3000',
    NODE_ENV: 'development',
  };

  const validProdConfig = {
    DATABASE_URL:
      'postgresql://user:pass@ep-prod-pooler.us-east-2.aws.neon.tech/db?sslmode=require&pgbouncer=true',
    DIRECT_URL:
      'postgresql://user:pass@ep-prod.us-east-2.aws.neon.tech/db?sslmode=require',
    JWT_ACCESS_SECRET: 'prod-access-secret-at-least-32-chars-long!',
    JWT_REFRESH_SECRET: 'prod-refresh-secret-different-and-32-chars!',
    CORS_ORIGINS: 'https://app.company.com,https://api.company.com',
    PORT: '3000',
    NODE_ENV: 'production',
  };

  describe('1. Baseline & Secret Validations', () => {
    it('passes when all required variables are valid and secrets are different', () => {
      const validated = validateEnv(validDevConfig);
      expect(validated.PORT).toBe(3000);
      expect(validated.COOKIE_SAMESITE).toBe('strict');
      expect(validated.PRISMA_TRANSACTION_MAX_WAIT).toBe(5000);
    });

    it('fails when DATABASE_URL is missing', () => {
      const invalidConfig = { ...validDevConfig, DATABASE_URL: '' };
      expect(() => validateEnv(invalidConfig)).toThrow('DATABASE_URL');
    });

    it('fails when JWT_ACCESS_SECRET is shorter than 32 characters', () => {
      const invalidConfig = {
        ...validDevConfig,
        JWT_ACCESS_SECRET: 'short-secret',
      };
      expect(() => validateEnv(invalidConfig)).toThrow(
        'at least 32 characters long',
      );
    });

    it('fails when JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical', () => {
      const sameSecret = 'identical-secret-that-is-over-32-characters-long!';
      const invalidConfig = {
        ...validDevConfig,
        JWT_ACCESS_SECRET: sameSecret,
        JWT_REFRESH_SECRET: sameSecret,
      };
      expect(() => validateEnv(invalidConfig)).toThrow('must be different');
    });
  });

  describe('2. Neon DIRECT_URL Constraint Rules', () => {
    it('fails when DIRECT_URL contains -pooler in hostname', () => {
      const invalidConfig = {
        ...validDevConfig,
        DIRECT_URL:
          'postgresql://user:pass@ep-test-pooler.us-east-2.aws.neon.tech/db',
      };
      expect(() => validateEnv(invalidConfig)).toThrow(
        'DIRECT_URL must be a direct unpooled connection and cannot contain "-pooler"',
      );
    });

    it('passes when DIRECT_URL does not contain -pooler', () => {
      const config = {
        ...validDevConfig,
        DIRECT_URL:
          'postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/db',
      };
      const validated = validateEnv(config);
      expect(validated.DIRECT_URL).toContain('ep-test.');
    });
  });

  describe('3. Production Strict Requirements (NODE_ENV=production)', () => {
    it('passes for a fully configured production environment', () => {
      const validated = validateEnv(validProdConfig);
      expect(validated.NODE_ENV).toBe('production');
      expect(validated.CORS_ORIGINS).toBe(
        'https://app.company.com,https://api.company.com',
      );
    });

    it('fails in production when DIRECT_URL is missing', () => {
      const { DIRECT_URL, ...withoutDirect } = validProdConfig;
      expect(() => validateEnv(withoutDirect)).toThrow(
        'DIRECT_URL is required in production',
      );
    });

    it('fails in production when CORS_ORIGINS is missing or empty', () => {
      const missingCors = { ...validProdConfig, CORS_ORIGINS: '' };
      expect(() => validateEnv(missingCors)).toThrow(
        'CORS_ORIGINS is required in production',
      );
    });

    it('fails in production when CORS_ORIGINS contains wildcard "*"', () => {
      const wildcardCors = { ...validProdConfig, CORS_ORIGINS: '*' };
      expect(() => validateEnv(wildcardCors)).toThrow(
        'CORS_ORIGINS cannot contain "*" in production',
      );
    });

    it('fails in production when CORS_ORIGINS contains an invalid URL', () => {
      const invalidUrlCors = {
        ...validProdConfig,
        CORS_ORIGINS: 'not-a-valid-url',
      };
      expect(() => validateEnv(invalidUrlCors)).toThrow(
        'Invalid origin URL in CORS_ORIGINS',
      );
    });

    it('fails in production when COOKIE_SAMESITE is none and COOKIE_SECURE is false', () => {
      const invalidCookieConfig = {
        ...validProdConfig,
        COOKIE_SAMESITE: 'none',
        COOKIE_SECURE: 'false',
      };
      expect(() => validateEnv(invalidCookieConfig)).toThrow(
        'COOKIE_SECURE must be true when COOKIE_SAMESITE is none in production',
      );
    });
  });

  describe('4. Startup Warnings (DATABASE_URL pooler & COOKIE_SAMESITE=none)', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('warns when DATABASE_URL has -pooler host but pgbouncer=true is missing', () => {
      const config = {
        ...validDevConfig,
        DATABASE_URL:
          'postgresql://user:pass@ep-prod-pooler.aws.neon.tech/db?sslmode=require',
      };
      validateEnv(config);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pgbouncer=true is missing'),
      );
    });

    it('does not warn about pgbouncer when DATABASE_URL has -pooler and pgbouncer=true', () => {
      const config = {
        ...validDevConfig,
        DATABASE_URL:
          'postgresql://user:pass@ep-prod-pooler.aws.neon.tech/db?sslmode=require&pgbouncer=true',
      };
      validateEnv(config);
      const poolerWarningCalls = warnSpy.mock.calls.filter((call) =>
        call[0]?.includes('pgbouncer=true is missing'),
      );
      expect(poolerWarningCalls).toHaveLength(0);
    });

    it('warns when COOKIE_SAMESITE is set to none', () => {
      const config = {
        ...validDevConfig,
        COOKIE_SAMESITE: 'none',
      };
      validateEnv(config);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('COOKIE_SAMESITE is set to "none"'),
      );
    });
  });
});
