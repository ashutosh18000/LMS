import { validateEnv } from '../src/config/env.validation';

describe('Environment Validation (Unit Tests)', () => {
  const validBaseConfig = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    DIRECT_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-chars-long!',
    JWT_REFRESH_SECRET: 'refresh-secret-that-is-different-and-32-chars!',
    PORT: '3000',
    NODE_ENV: 'test',
  };

  it('passes when all required variables are valid and secrets are different', () => {
    const validated = validateEnv(validBaseConfig);
    expect(validated.PORT).toBe(3000);
    expect(validated.COOKIE_SAMESITE).toBe('strict');
    expect(validated.PRISMA_TRANSACTION_MAX_WAIT).toBe(5000);
  });

  it('fails when DATABASE_URL is missing', () => {
    const invalidConfig = { ...validBaseConfig, DATABASE_URL: '' };
    expect(() => validateEnv(invalidConfig)).toThrow('DATABASE_URL');
  });

  it('fails when JWT_ACCESS_SECRET is shorter than 32 characters', () => {
    const invalidConfig = { ...validBaseConfig, JWT_ACCESS_SECRET: 'short-secret' };
    expect(() => validateEnv(invalidConfig)).toThrow('at least 32 characters long');
  });

  it('fails when JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical', () => {
    const sameSecret = 'identical-secret-that-is-over-32-characters-long!';
    const invalidConfig = {
      ...validBaseConfig,
      JWT_ACCESS_SECRET: sameSecret,
      JWT_REFRESH_SECRET: sameSecret,
    };
    expect(() => validateEnv(invalidConfig)).toThrow('must be different');
  });

  it('applies default values for optional configurations', () => {
    const minimalConfig = {
      DATABASE_URL: 'postgresql://localhost:5432/db',
      JWT_ACCESS_SECRET: 'access-secret-that-is-at-least-32-chars-long!',
      JWT_REFRESH_SECRET: 'refresh-secret-that-is-different-and-32-chars!',
    };
    const validated = validateEnv(minimalConfig);
    expect(validated.PORT).toBe(3000);
    expect(validated.NODE_ENV).toBe('development');
    expect(validated.COOKIE_SAMESITE).toBe('strict');
    expect(validated.PRISMA_TRANSACTION_TIMEOUT).toBe(10000);
  });
});
