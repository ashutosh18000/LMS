import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { OrgStatus, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { DummyProtectedController } from './dummy-protected.controller';
import { ThrottlerGuard } from '@nestjs/throttler';

dotenv.config();

// Ensure test database connection is used if configured
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
}

describe('Authentication & Authorization E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [DummyProtectedController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  // Clean all tables before each test to ensure strict test isolation
  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.leaveSegmentDay.deleteMany();
    await prisma.leaveSegment.deleteMany();
    await prisma.leaveRequest.deleteMany();
    await prisma.balanceAdjustment.deleteMany();
    await prisma.leaveBalance.deleteMany();
    await prisma.carryForwardRun.deleteMany();
    await prisma.employeeSchedule.deleteMany();
    await prisma.workScheduleTemplate.deleteMany();
    await prisma.leaveType.deleteMany();
    await prisma.holiday.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  // Helper to extract refreshToken cookie value from Set-Cookie headers
  function extractRefreshToken(res: request.Response): string | undefined {
    const raw = res.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
      ? [raw]
      : [];
    const cookie = cookies.find((c) => c.startsWith('refreshToken='));
    if (!cookie) return undefined;
    return cookie.split(';')[0].replace('refreshToken=', '');
  }

  // 1. Login success test
  it('1. POST /auth/login - should log in successfully with valid credentials, return accessToken and httpOnly cookie', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'staff@acme.com',
        name: 'Staff Member',
        passwordHash: hash,
        role: Role.staff,
        mustChangePassword: false,
        active: true,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'STAFF@acme.com', password: 'Password123!' })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body.mustChangePassword).toBe(false);
    expect(res.body.user).toEqual({
      id: user.id,
      name: 'Staff Member',
      role: Role.staff,
      orgId: org.id,
    });

    // Check Set-Cookie headers for secure httpOnly attributes
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookiesArray: string[] = Array.isArray(setCookie)
      ? setCookie
      : typeof setCookie === 'string'
      ? [setCookie]
      : [];
    const cookieString = cookiesArray.find((c) =>
      c.startsWith('refreshToken='),
    );
    expect(cookieString).toBeDefined();
    expect(cookieString).toContain('HttpOnly');
    expect(cookieString).toContain('Path=/auth');
    expect(cookieString).toContain('SameSite=Strict');

    // Confirm that the refresh token is saved hashed in DB, never plaintext
    const dbToken = await prisma.refreshToken.findFirst({
      where: { userId: user.id },
    });
    expect(dbToken).toBeDefined();
    const rawToken = extractRefreshToken(res);
    expect(dbToken?.tokenHash).not.toEqual(rawToken);
  });

  // 2. Wrong password test
  it('2. POST /auth/login - should fail with 401 "Invalid credentials" on wrong password', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'staff@acme.com',
        name: 'Staff Member',
        passwordHash: hash,
        role: Role.staff,
        active: true,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'staff@acme.com', password: 'WrongPassword!' })
      .expect(401);

    expect(res.body.message).toBe('Invalid credentials');
  });

  // 3. Inactive user test
  it('3. POST /auth/login - should block inactive user (active=false) with 401', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'inactive@acme.com',
        name: 'Inactive User',
        passwordHash: hash,
        role: Role.staff,
        active: false,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'inactive@acme.com', password: 'Password123!' })
      .expect(401);

    expect(res.body.message).toBe('Account is inactive');

    // Test fix: Inactive user with WRONG password must return generic "Invalid credentials"
    const wrongPassRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'inactive@acme.com', password: 'WrongPassword!' })
      .expect(401);

    expect(wrongPassRes.body.message).toBe('Invalid credentials');
  });

  // 4. Suspended organization test
  it('4. POST /auth/login - should block user if organization is suspended with 401', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Suspended Corp', status: OrgStatus.suspended },
    });

    const hash = await passwordService.hash('Password123!');
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'user@suspended.com',
        name: 'Suspended User',
        passwordHash: hash,
        role: Role.staff,
        active: true,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@suspended.com', password: 'Password123!' })
      .expect(401);

    expect(res.body.message).toBe('Organization is suspended');

    // Test fix: Suspended org user with WRONG password must return generic "Invalid credentials"
    const wrongPassRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@suspended.com', password: 'WrongPassword!' })
      .expect(401);

    expect(wrongPassRes.body.message).toBe('Invalid credentials');
  });

  it('4b. POST /auth/refresh - should block and wipe tokens when user is inactive or org is suspended', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Active', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'refresh_test@acme.com',
        name: 'Refresh Test User',
        passwordHash: hash,
        role: Role.staff,
        active: true,
      },
    });

    // Login to get valid token
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'refresh_test@acme.com', password: 'Password123!' })
      .expect(200);

    const refreshToken = extractRefreshToken(loginRes);

    // Case A: Deactivate user -> refresh must fail with 401 and wipe tokens
    await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });

    const inactiveRefreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(401);

    expect(inactiveRefreshRes.body.message).toBe('Account is inactive or not found');

    let tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens.length).toBe(0);

    // Reactivate user and create new token for Case B
    await prisma.user.update({
      where: { id: user.id },
      data: { active: true },
    });

    const loginRes2 = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'refresh_test@acme.com', password: 'Password123!' })
      .expect(200);

    const refreshToken2 = extractRefreshToken(loginRes2);

    // Case B: Suspend organization -> refresh must fail with 401 and wipe tokens
    await prisma.organization.update({
      where: { id: org.id },
      data: { status: OrgStatus.suspended },
    });

    const suspendedRefreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken2}`])
      .expect(401);

    expect(suspendedRefreshRes.body.message).toBe('Organization is suspended');

    tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens.length).toBe(0);
  });

  // 5. Refresh token rotation test
  it('5. POST /auth/refresh - should rotate refresh token and issue new accessToken and new cookie', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'user@acme.com',
        name: 'Regular User',
        passwordHash: hash,
        role: Role.staff,
        active: true,
      },
    });

    // Login to obtain initial tokens
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@acme.com', password: 'Password123!' })
      .expect(200);

    const initialRefreshToken = extractRefreshToken(loginRes);
    expect(initialRefreshToken).toBeDefined();

    // Call /auth/refresh with initial cookie
    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${initialRefreshToken}`])
      .expect(200);

    expect(refreshRes.body).toHaveProperty('accessToken');
    const rotatedRefreshToken = extractRefreshToken(refreshRes);
    expect(rotatedRefreshToken).toBeDefined();
    expect(rotatedRefreshToken).not.toEqual(initialRefreshToken);

    // Verify in DB that only 1 token exists for this user (old was deleted, new created)
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.length).toBe(1);
  });

  // 6. Token reuse detection test
  it('6. POST /auth/refresh - reuse detection: replaying an old refresh token invalidates ALL user tokens', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'user@acme.com',
        name: 'Regular User',
        passwordHash: hash,
        role: Role.staff,
        active: true,
      },
    });

    // 1st login
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'user@acme.com', password: 'Password123!' })
      .expect(200);

    const originalToken = extractRefreshToken(loginRes);

    // 1st valid refresh -> originalToken gets rotated out
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${originalToken}`])
      .expect(200);

    // Verify token exists in DB for user
    let userTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(userTokens.length).toBe(1);

    // Replay attack: Attacker tries using the already-rotated originalToken
    const replayRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${originalToken}`])
      .expect(401);

    expect(replayRes.body.message).toContain('Invalid or reused refresh token');

    // Reuse detection penalty: ALL refresh tokens for the user MUST be wiped
    userTokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(userTokens.length).toBe(0);
  });

  // 7. Logout test
  it('7. POST /auth/logout - clears cookie and deletes token from DB, subsequent refresh fails', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'logout@acme.com',
        name: 'Logout User',
        passwordHash: hash,
        role: Role.staff,
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'logout@acme.com', password: 'Password123!' })
      .expect(200);

    const refreshToken = extractRefreshToken(loginRes);

    // Logout
    const logoutRes = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(200);

    expect(logoutRes.body.message).toBe('Logged out successfully');

    // Confirm token row is deleted in DB
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.length).toBe(0);

    // Subsequent refresh attempt must fail
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refreshToken=${refreshToken}`])
      .expect(401);
  });

  // 8. MustChangePasswordGuard test
  it('8. MustChangePasswordGuard - when mustChangePassword=true, blocks general routes with 403, allows /auth/me and /auth/change-password', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('TempPassword123!');
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'mustchange@acme.com',
        name: 'Must Change User',
        passwordHash: hash,
        role: Role.staff,
        mustChangePassword: true,
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'mustchange@acme.com', password: 'TempPassword123!' })
      .expect(200);

    const { accessToken } = loginRes.body;

    // Accessing general protected route must be BLOCKED with 403
    const blockedRes = await request(app.getHttpServer())
      .get('/test-protected/general')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(blockedRes.body.message).toBe('Password change required');

    // Accessing /auth/me must be ALLOWED
    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(meRes.body.mustChangePassword).toBe(true);
  });

  // 9. Change password test
  it('9. POST /auth/change-password - changes password, revokes old tokens, creates audit log, grants access', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('OldPassword123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'change@acme.com',
        name: 'Change User',
        passwordHash: hash,
        role: Role.staff,
        mustChangePassword: true,
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'change@acme.com', password: 'OldPassword123!' })
      .expect(200);

    const oldAccessToken = loginRes.body.accessToken;

    // Change password
    const changeRes = await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${oldAccessToken}`)
      .send({
        oldPassword: 'OldPassword123!',
        newPassword: 'BrandNewSecurePassword123!',
      })
      .expect(200);

    expect(changeRes.body).toHaveProperty('accessToken');
    expect(changeRes.body.message).toBe('Password changed successfully');

    // Confirm user's mustChangePassword is now false
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
    });
    expect(updatedUser?.mustChangePassword).toBe(false);

    // Confirm audit log entry was created
    const audit = await prisma.auditLog.findFirst({
      where: { actorId: user.id, action: 'USER_PASSWORD_CHANGE' },
    });
    expect(audit).toBeDefined();
    expect(audit?.orgId).toBe(org.id);

    // Access to general route is now granted with new access token
    const newAccessToken = changeRes.body.accessToken;
    const accessRes = await request(app.getHttpServer())
      .get('/test-protected/general')
      .set('Authorization', `Bearer ${newAccessToken}`)
      .expect(200);

    expect(accessRes.body.message).toBe('Access granted to authenticated user');
  });

  // 10. Role hierarchy guard test
  it('10. RolesGuard - staff token receives 403 on HR route; hr_admin and org_owner receive 200', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');

    // Create staff user
    const staff = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'staff1@acme.com',
        name: 'Staff 1',
        passwordHash: hash,
        role: Role.staff,
        mustChangePassword: false,
        active: true,
      },
    });

    // Create hr_admin user
    const hr = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'hr1@acme.com',
        name: 'HR 1',
        passwordHash: hash,
        role: Role.hr_admin,
        mustChangePassword: false,
        active: true,
      },
    });

    // Create org_owner user
    const owner = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'owner1@acme.com',
        name: 'Owner 1',
        passwordHash: hash,
        role: Role.org_owner,
        mustChangePassword: false,
        active: true,
      },
    });

    // Log in all 3 users
    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staff.email, password: 'Password123!' });
    const hrLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: hr.email, password: 'Password123!' });
    const ownerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: owner.email, password: 'Password123!' });

    // 1. Staff accessing HR-only route -> 403
    const staffRes = await request(app.getHttpServer())
      .get('/test-protected/hr-only')
      .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
      .expect(403);
    expect(staffRes.body.message).toBe('Insufficient permissions');

    // 2. HR accessing HR-only route -> 200
    await request(app.getHttpServer())
      .get('/test-protected/hr-only')
      .set('Authorization', `Bearer ${hrLogin.body.accessToken}`)
      .expect(200);

    // 3. Org Owner (higher rank) accessing HR-only route -> 200
    await request(app.getHttpServer())
      .get('/test-protected/hr-only')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .expect(200);
  });

  // 11. Real-time token revocation upon organization suspension
  it('11. Suspended org revokes active access token immediately with 401 on next request', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme Corp', status: OrgStatus.active },
    });

    const hash = await passwordService.hash('Password123!');
    const user = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'activeuser@acme.com',
        name: 'Active User',
        passwordHash: hash,
        role: Role.staff,
        mustChangePassword: false,
        active: true,
      },
    });

    // Log in while org is active
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'Password123!' })
      .expect(200);

    const token = loginRes.body.accessToken;

    // First request succeeds
    await request(app.getHttpServer())
      .get('/test-protected/general')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Organization is now suspended in DB (admin action)
    await prisma.organization.update({
      where: { id: org.id },
      data: { status: OrgStatus.suspended },
    });

    // Immediate next request with same token MUST BE BLOCKED with 401
    const revokedRes = await request(app.getHttpServer())
      .get('/test-protected/general')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(revokedRes.body.message).toBe('Organization is suspended');
  });
});
