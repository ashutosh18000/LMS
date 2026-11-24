const { isAllowedTestDatabase } = require('./e2e-env-guard');
import { cleanTestDatabase } from './test-helpers';

describe('Test Safety Guard (Database Name Verification)', () => {
  describe('isAllowedTestDatabase validation', () => {
    it('accepts databases containing "test"', () => {
      expect(isAllowedTestDatabase('testdb')).toBe(true);
      expect(isAllowedTestDatabase('neondb_test')).toBe(true);
      expect(isAllowedTestDatabase('lms_test_db')).toBe(true);
      expect(isAllowedTestDatabase('acme_testing')).toBe(true);
      expect(isAllowedTestDatabase('TESTDB')).toBe(true);
    });

    it('rejects forbidden production and demo databases', () => {
      expect(isAllowedTestDatabase('neondb')).toBe(false);
      expect(isAllowedTestDatabase('postgres')).toBe(false);
      expect(isAllowedTestDatabase('master')).toBe(false);
      expect(isAllowedTestDatabase('production')).toBe(false);
      expect(isAllowedTestDatabase('prod')).toBe(false);
      expect(isAllowedTestDatabase('demo')).toBe(false);
    });

    it('rejects arbitrary non-test database names', () => {
      expect(isAllowedTestDatabase('acme_production_db')).toBe(false);
      expect(isAllowedTestDatabase('user_data')).toBe(false);
      expect(isAllowedTestDatabase('company_crm')).toBe(false);
      expect(isAllowedTestDatabase('')).toBe(false);
      expect(isAllowedTestDatabase(null as any)).toBe(false);
      expect(isAllowedTestDatabase(undefined as any)).toBe(false);
    });
  });

  describe('cleanTestDatabase safeguard', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('throws fatal error if DATABASE_URL points to neondb', async () => {
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-empty-salad-aomku4fy-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';

      const mockPrisma = {
        $executeRawUnsafe: jest.fn(),
      } as any;

      await expect(cleanTestDatabase(mockPrisma)).rejects.toThrow(
        /cleanTestDatabase aborted! Target database "neondb" is not an allowed test database/,
      );
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('throws fatal error if NODE_ENV is not test', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://user:pass@host/testdb?sslmode=require';

      const mockPrisma = {
        $executeRawUnsafe: jest.fn(),
      } as any;

      await expect(cleanTestDatabase(mockPrisma)).rejects.toThrow(
        /cleanTestDatabase is strictly forbidden outside NODE_ENV=test/,
      );
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });
});
