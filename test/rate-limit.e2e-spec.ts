import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { TokensService } from '../src/auth/tokens.service';
import { LoginAttemptService } from '../src/auth/login-attempt.service';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { OrgStatus, Role } from '@prisma/client';

describe('Rate Limiting & Tiered Throttling E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokensService: TokensService;
  let loginAttemptService: LoginAttemptService;

  beforeAll(async () => {
    // Enable rate limiting specifically for this test suite
    process.env.THROTTLE_DISABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
    passwordService = app.get<PasswordService>(PasswordService);
    tokensService = app.get<TokensService>(TokensService);
    loginAttemptService = app.get<LoginAttemptService>(LoginAttemptService);
  });

  afterAll(async () => {
    // Restore default test behavior (bypassing throttle for other test suites)
    delete process.env.THROTTLE_DISABLED;
    await app.close();
  });

  describe('1. Login IP Rate Limit (10 req/min)', () => {
    it('allows 10 requests and rejects the 11th with 429 and Retry-After header', async () => {
      // Send 10 login requests
      for (let i = 1; i <= 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: `test-${i}@example.com`, password: 'WrongPassword123!' });
        expect(res.status).not.toBe(429);
      }

      // 11th request must receive 429 Too Many Requests
      const blockedRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test-11@example.com', password: 'WrongPassword123!' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
        message: expect.any(String),
      });
      expect(blockedRes.body).toHaveProperty('details');
      expect(blockedRes.headers).toHaveProperty('retry-after');
      expect(Number(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('2. Refresh Token Rate Limit (10 req/min)', () => {
    it('allows 10 requests and rejects the 11th with 429 and Retry-After header', async () => {
      // Send 10 refresh requests
      for (let i = 1; i <= 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/refresh')
          .send();
        expect(res.status).toBe(401); // 401 because cookie is missing, but not rate limited
      }

      // 11th request must receive 429
      const blockedRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send();

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
      });
      expect(blockedRes.headers).toHaveProperty('retry-after');
    });
  });

  describe('3. Change Password Rate Limit (5 req/min tier, independent from login)', () => {
    it('allows 5 requests and rejects the 6th with 429 and Retry-After header', async () => {
      // Send 5 change-password requests
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/auth/change-password')
          .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });
        expect(res.status).toBe(401); // 401 unauthorized because no token, but not rate-limited
      }

      // 6th request must receive 429
      const blockedRes = await request(app.getHttpServer())
        .post('/auth/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
      });
      expect(blockedRes.headers).toHaveProperty('retry-after');
    });
  });

  describe('4. Platform Rate Limit (20 req/min)', () => {
    it('allows 20 requests and rejects the 21st with 429 and Retry-After header', async () => {
      // Send 20 platform requests
      for (let i = 1; i <= 20; i++) {
        const res = await request(app.getHttpServer())
          .get('/platform/organizations')
          .send();
        expect(res.status).toBe(401); // 401 unauthorized, not rate limited
      }

      // 21st request must receive 429
      const blockedRes = await request(app.getHttpServer())
        .get('/platform/organizations')
        .send();

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toMatchObject({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
      });
      expect(blockedRes.headers).toHaveProperty('retry-after');
    });
  });

  describe('5. Email-Based Brute-Force Rate Limiting', () => {
    it('temporarily blocks an email after 10 failed login attempts without revealing user existence', async () => {
      const targetEmail = 'bruteforce-target@acme.com';

      // Record 10 failed attempts on this specific email
      for (let i = 0; i < 10; i++) {
        loginAttemptService.recordFailedAttempt(targetEmail);
      }

      const check = loginAttemptService.isBlocked(targetEmail);
      expect(check.blocked).toBe(true);
      expect(check.retryAfterSeconds).toBeGreaterThan(0);

      // Reset attempts clears the block
      loginAttemptService.resetAttempts(targetEmail);
      expect(loginAttemptService.isBlocked(targetEmail).blocked).toBe(false);
    });

    it('works identically for non-existent users without leaking account presence', async () => {
      const nonExistentEmail = 'nonexistent-target@acme.com';
      for (let i = 0; i < 10; i++) {
        loginAttemptService.recordFailedAttempt(nonExistentEmail);
      }
      expect(loginAttemptService.isBlocked(nonExistentEmail).blocked).toBe(true);
      loginAttemptService.resetAttempts(nonExistentEmail);
    });
  });
});
