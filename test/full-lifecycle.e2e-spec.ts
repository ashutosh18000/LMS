import * as path from "path";
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { ClockService } from '../src/common/services/clock.service';
import { Role } from '@prisma/client';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Full Enterprise Lifecycle E2E Test', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let clockService: ClockService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
    clockService = app.get<ClockService>(ClockService);
  });

  afterAll(async () => {
    clockService.setFixedToday(null);
    await app.close();
  });

  beforeAll(async () => {
    // Database cleanup prior to running the end-to-end lifecycle
    await cleanTestDatabase(prisma);
  });

  it('executes complete production lifecycle from platform bootstrap to suspension', async () => {
    // -------------------------------------------------------------------------
    // Step 0: Bootstrap Root Super-Admin in Database
    // -------------------------------------------------------------------------
    const rootEmail = 'root@platform.com';
    const rootPass = 'RootSecret123!';
    const rootHash = await passwordService.hash(rootPass);

    await prisma.user.create({
      data: {
        email: rootEmail,
        name: 'Super Root',
        role: Role.root,
        orgId: null,
        passwordHash: rootHash,
        mustChangePassword: false,
        active: true,
      },
    });

    // -------------------------------------------------------------------------
    // Step 1: Root Login
    // -------------------------------------------------------------------------
    const rootLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: rootEmail, password: rootPass })
      .expect(200);

    expect(rootLoginRes.body.accessToken).toBeDefined();
    const rootToken = rootLoginRes.body.accessToken;

    // -------------------------------------------------------------------------
    // Step 2: Org + Owner Creation by Root
    // -------------------------------------------------------------------------
    const createOrgRes = await request(app.getHttpServer())
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${rootToken}`)
      .send({
        orgName: 'Horizon Corp',
        ownerName: 'Helen Owner',
        ownerEmail: 'owner@horizon.com',
        tempPassword: 'OwnerTemp123!',
      })
      .expect(201);

    expect(createOrgRes.body.organization.id).toBeDefined();
    expect(createOrgRes.body.organization.name).toBe('Horizon Corp');
    expect(createOrgRes.body.owner.email).toBe('owner@horizon.com');

    const orgId = createOrgRes.body.organization.id;
    const initialOwnerId = createOrgRes.body.owner.id;

    // -------------------------------------------------------------------------
    // Step 3: Owner First Login & Mandatory Password Change
    // -------------------------------------------------------------------------
    const ownerFirstLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@horizon.com', password: 'OwnerTemp123!' })
      .expect(200);

    const ownerTempToken = ownerFirstLogin.body.accessToken;

    // Blocked from accessing org endpoints while mustChangePassword is true
    await request(app.getHttpServer())
      .get('/org/settings')
      .set('Authorization', `Bearer ${ownerTempToken}`)
      .expect(403);

    // Complete password change
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${ownerTempToken}`)
      .send({
        oldPassword: 'OwnerTemp123!',
        newPassword: 'OwnerPerm123!',
      })
      .expect(200);

    // Re-login with permanent password
    const ownerPermLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@horizon.com', password: 'OwnerPerm123!' })
      .expect(200);

    const ownerToken = ownerPermLogin.body.accessToken;

    // -------------------------------------------------------------------------
    // Step 4: Configure Organization Settings
    // -------------------------------------------------------------------------
    const updateSettingsRes = await request(app.getHttpServer())
      .patch('/org/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        timezone: 'Asia/Kolkata',
        financialYearStartMonth: 4,
        workingDays: [1, 2, 3, 4, 5],
        backdateAllowedDays: 14,
      })
      .expect(200);

    expect(updateSettingsRes.body.settings.timezone).toBe('Asia/Kolkata');
    expect(updateSettingsRes.body.settings.financialYearStartMonth).toBe(4);
    expect(updateSettingsRes.body.settings.backdateAllowedDays).toBe(14);

    // -------------------------------------------------------------------------
    // Step 5: Owner Creates HR Administrator
    // -------------------------------------------------------------------------
    const createHrRes = await request(app.getHttpServer())
      .post('/org/hr-admins')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        email: 'hr@horizon.com',
        name: 'Harold HR Admin',
        tempPassword: 'HrTemp123!',
      })
      .expect(201);

    const hrUserId = createHrRes.body.id;

    // HR login and password change
    const hrTempLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'hr@horizon.com', password: 'HrTemp123!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${hrTempLogin.body.accessToken}`)
      .send({
        oldPassword: 'HrTemp123!',
        newPassword: 'HrPerm123!',
      })
      .expect(200);

    const hrPermLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'hr@horizon.com', password: 'HrPerm123!' })
      .expect(200);

    const hrToken = hrPermLogin.body.accessToken;

    // -------------------------------------------------------------------------
    // Step 6: HR Configures Leave Types, Work Schedules, and Holidays
    // -------------------------------------------------------------------------
    // Leave Types
    const casualRes = await request(app.getHttpServer())
      .post('/leave-types')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Casual Leave',
        paid: true,
        daysPerYear: 12,
        deductsBalance: true,
        isWfh: false,
        halfDayAllowed: true,
      })
      .expect(201);
    const casualTypeId = casualRes.body.id;

    const sickRes = await request(app.getHttpServer())
      .post('/leave-types')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Sick Leave',
        paid: true,
        daysPerYear: 8,
        deductsBalance: true,
        isWfh: false,
        halfDayAllowed: true,
      })
      .expect(201);
    const sickTypeId = sickRes.body.id;

    const wfhRes = await request(app.getHttpServer())
      .post('/leave-types')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Work From Home',
        paid: true,
        monthlyLimit: 4,
        deductsBalance: false,
        isWfh: true,
        halfDayAllowed: true,
      })
      .expect(201);
    const wfhTypeId = wfhRes.body.id;

    // Schedule Templates
    const tpl5Res = await request(app.getHttpServer())
      .post('/schedule-templates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Standard 5-day',
        saturdayMode: 'off',
        alternateOffWeeks: [],
      })
      .expect(201);
    const tpl5DayId = tpl5Res.body.id;

    const tplHalfRes = await request(app.getHttpServer())
      .post('/schedule-templates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Saturday Half-Day Shift',
        saturdayMode: 'half',
        alternateOffWeeks: [],
      })
      .expect(201);
    const tplHalfId = tplHalfRes.body.id;

    const tplAltRes = await request(app.getHttpServer())
      .post('/schedule-templates')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Alternate 1st & 3rd Off',
        saturdayMode: 'alternate',
        alternateOffWeeks: [1, 3],
      })
      .expect(201);
    const tplAltId = tplAltRes.body.id;

    // Holiday
    await request(app.getHttpServer())
      .post('/holidays')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        name: 'Diwali',
        date: '2026-11-11',
      })
      .expect(201);

    // -------------------------------------------------------------------------
    // Step 7: HR Creates Manager and Staff Members (with schedules)
    // -------------------------------------------------------------------------
    // Manager
    const mgrCreate = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        email: 'manager@horizon.com',
        name: 'Mona Manager',
        role: 'manager',
        tempPassword: 'MgrTemp123!',
        department: 'Engineering',
      })
      .expect(201);
    const managerId = mgrCreate.body.id;

    // Staff 1 (Standard 5-day)
    const staff1Create = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        email: 'staff1@horizon.com',
        name: 'Sam Staff',
        role: 'staff',
        managerId,
        tempPassword: 'StaffTemp123!',
        department: 'Engineering',
      })
      .expect(201);
    const staff1Id = staff1Create.body.id;

    // Staff 2 (Saturday Half)
    const staff2Create = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        email: 'staff2@horizon.com',
        name: 'Sara Staff',
        role: 'staff',
        managerId,
        tempPassword: 'StaffTemp123!',
        department: 'Engineering',
      })
      .expect(201);
    const staff2Id = staff2Create.body.id;

    // Staff 3 (Alternate Saturdays)
    const staff3Create = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        email: 'staff3@horizon.com',
        name: 'Steve Staff',
        role: 'staff',
        managerId,
        tempPassword: 'StaffTemp123!',
        department: 'Engineering',
      })
      .expect(201);
    const staff3Id = staff3Create.body.id;

    // Assign schedules
    await request(app.getHttpServer())
      .post(`/users/${managerId}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ templateId: tpl5DayId, effectiveFrom: '2026-01-01' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${staff1Id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ templateId: tpl5DayId, effectiveFrom: '2026-01-01' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${staff2Id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ templateId: tplHalfId, effectiveFrom: '2026-01-01' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/users/${staff3Id}/schedule`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ templateId: tplAltId, effectiveFrom: '2026-01-01' })
      .expect(201);

    // Passwords setup for users
    const setupUserPassword = async (email: string, temp: string, perm: string) => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: temp })
        .expect(200);
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .send({ oldPassword: temp, newPassword: perm })
        .expect(200);
      const permLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: perm })
        .expect(200);
      return permLogin.body.accessToken;
    };

    const managerToken = await setupUserPassword('manager@horizon.com', 'MgrTemp123!', 'MgrPerm123!');
    const staff1Token = await setupUserPassword('staff1@horizon.com', 'StaffTemp123!', 'StaffPerm123!');
    const staff2Token = await setupUserPassword('staff2@horizon.com', 'StaffTemp123!', 'StaffPerm123!');

    // -------------------------------------------------------------------------
    // Step 8: Allocate Leave Balances for 2026
    // -------------------------------------------------------------------------
    const allocRes = await request(app.getHttpServer())
      .post('/balances/allocate')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        year: 2026,
      })
      .expect(200);

    expect(allocRes.body.created).toBeGreaterThan(0);

    // -------------------------------------------------------------------------
    // Step 9: Staff 1 Submits Multi-Segment Leave + WFH Request
    // -------------------------------------------------------------------------
    clockService.setFixedToday('2026-11-01');

    const applyRes = await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({
        segments: [
          {
            leaveTypeId: casualTypeId,
            startDate: '2026-11-02',
            endDate: '2026-11-03',
            portion: 'full',
          },
          {
            leaveTypeId: wfhTypeId,
            startDate: '2026-11-04',
            endDate: '2026-11-04',
            portion: 'full',
          },
        ],
        reason: 'Personal affairs and remote work',
      })
      .expect(201);

    expect(applyRes.body.id).toBeDefined();
    expect(applyRes.body.status).toBe('pending');
    expect(Number(applyRes.body.countedDays)).toBe(3);
    const leaveRequestId = applyRes.body.id;

    // Verify balance was reserved (Casual Leave has pending = 2)
    const staff1BalancesRes = await request(app.getHttpServer())
      .get('/me/balances')
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);

    const casualBal = staff1BalancesRes.body.items.find((b: any) => b.leaveTypeId === casualTypeId);
    expect(Number(casualBal.pending)).toBe(2);
    expect(Number(casualBal.used)).toBe(0);

    // -------------------------------------------------------------------------
    // Step 10: Overlap Validation Error
    // -------------------------------------------------------------------------
    const overlapRes = await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${staff1Token}`)
      .send({
        segments: [
          {
            leaveTypeId: casualTypeId,
            startDate: '2026-11-03',
            endDate: '2026-11-03',
            portion: 'full',
          },
        ],
        reason: 'Overlapping request',
      })
      .expect(409);

    expect(overlapRes.body.code).toBe('OVERLAP');

    // -------------------------------------------------------------------------
    // Step 11: HR Pending Approvals Inbox & Approval
    // -------------------------------------------------------------------------
    const pendingListRes = await request(app.getHttpServer())
      .get('/approvals/pending')
      .set('Authorization', `Bearer ${hrToken}`)
      .expect(200);

    expect(pendingListRes.body.items.some((r: any) => r.id === leaveRequestId)).toBe(true);

    const approveRes = await request(app.getHttpServer())
      .post(`/approvals/${leaveRequestId}/approve`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        comment: 'Approved per company policy',
      })
      .expect(200);

    expect(approveRes.body.status).toBe('approved');

    // -------------------------------------------------------------------------
    // Step 12: Balance Commits to Used
    // -------------------------------------------------------------------------
    const afterApproveBalRes = await request(app.getHttpServer())
      .get('/me/balances')
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);

    const casualAfter = afterApproveBalRes.body.items.find((b: any) => b.leaveTypeId === casualTypeId);
    expect(Number(casualAfter.used)).toBe(2);
    expect(Number(casualAfter.pending)).toBe(0);

    // -------------------------------------------------------------------------
    // Step 13: Staff Dashboard Reflection
    // -------------------------------------------------------------------------
    const staffDashRes = await request(app.getHttpServer())
      .get('/dashboard/me')
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);

    expect(staffDashRes.body.balances).toBeDefined();
    expect(staffDashRes.body.upcomingLeaves).toBeDefined();

    // -------------------------------------------------------------------------
    // Step 14: Manager Team View (Privacy Shield) & Peer My-Team View
    // -------------------------------------------------------------------------
    const teamAvailRes = await request(app.getHttpServer())
      .get('/team/availability?from=2026-11-01&to=2026-11-14')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    expect(teamAvailRes.body.holidays).toBeDefined();
    expect(teamAvailRes.body.members).toHaveLength(3);

    // Deep privacy scan on /team/availability
    const serializedTeam = JSON.stringify(teamAvailRes.body);
    expect(serializedTeam).not.toContain('reason');
    expect(serializedTeam).not.toContain('leaveTypeId');
    expect(serializedTeam).not.toContain('Casual Leave');
    expect(serializedTeam).not.toContain('balance');
    expect(serializedTeam).not.toContain('Standard 5-day');

    // Peer view from Staff 2 (sees Staff 1, Staff 3, and Manager)
    const myTeamRes = await request(app.getHttpServer())
      .get('/my-team/availability?from=2026-11-01&to=2026-11-14')
      .set('Authorization', `Bearer ${staff2Token}`)
      .expect(200);

    expect(myTeamRes.body.members).toBeDefined();
    const myTeamIds = myTeamRes.body.members.map((m: any) => m.userId);
    expect(myTeamIds).toContain(staff1Id);
    expect(myTeamIds).toContain(managerId);

    // -------------------------------------------------------------------------
    // Step 15: Saturday Availability Check on Today Endpoint
    // -------------------------------------------------------------------------
    // Set today to Saturday, 7 Nov 2026 (1st Saturday of the month)
    clockService.setFixedToday('2026-11-07');

    const satTodayRes = await request(app.getHttpServer())
      .get('/team/availability/today')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    const s1 = satTodayRes.body.members.find((m: any) => m.userId === staff1Id);
    const s2 = satTodayRes.body.members.find((m: any) => m.userId === staff2Id);
    const s3 = satTodayRes.body.members.find((m: any) => m.userId === staff3Id);

    // Staff 1 (Standard 5-day): Saturday is off
    expect(s1.status).toBe('off');
    // Staff 2 (Saturday Half): Available with halfDay: true
    expect(s2.status).toBe('available');
    expect(s2.halfDay).toBe(true);
    // Staff 3 (Alternate [1, 3] off): 1st Saturday is off
    expect(s3.status).toBe('off');

    // -------------------------------------------------------------------------
    // Step 16: HR Cancels Approved Leave -> Balance Refunded
    // -------------------------------------------------------------------------
    const cancelRes = await request(app.getHttpServer())
      .post(`/leave-requests/${leaveRequestId}/cancel-approved`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ reason: 'Operational exigency cancellation' })
      .expect(200);

    expect(cancelRes.body.status).toBe('cancelled');

    const afterCancelBal = await request(app.getHttpServer())
      .get('/me/balances')
      .set('Authorization', `Bearer ${staff1Token}`)
      .expect(200);

    const casualRefunded = afterCancelBal.body.items.find((b: any) => b.leaveTypeId === casualTypeId);
    expect(Number(casualRefunded.used)).toBe(0);
    expect(Number(casualRefunded.pending)).toBe(0);

    // -------------------------------------------------------------------------
    // Step 17: HR Submits On-Behalf Backdated Leave with autoApprove: true
    // -------------------------------------------------------------------------
    const onBehalfRes = await request(app.getHttpServer())
      .post('/leave-requests/on-behalf')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        userId: staff1Id,
        segments: [
          {
            leaveTypeId: casualTypeId,
            startDate: '2026-11-05',
            endDate: '2026-11-05',
            portion: 'full',
          },
        ],
        reason: 'Personal medical emergency',
        onBehalfReason: 'Employee called in sick; HR recorded on behalf',
        autoApprove: true,
      })
      .expect(201);

    expect(onBehalfRes.body.status).toBe('approved');

    // -------------------------------------------------------------------------
    // Step 18: HR Admin Applies for Leave -> Owner Approves (HR Cannot Self-Approve)
    // -------------------------------------------------------------------------
    const hrLeaveRes = await request(app.getHttpServer())
      .post('/leave-requests')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        segments: [
          {
            leaveTypeId: sickTypeId,
            startDate: '2026-11-16',
            endDate: '2026-11-17',
            portion: 'full',
          },
        ],
        reason: 'HR administrator medical appointment',
      })
      .expect(201);

    const hrRequestId = hrLeaveRes.body.id;

    // Self-approval attempt by HR MUST fail with 403 Forbidden
    await request(app.getHttpServer())
      .post(`/approvals/${hrRequestId}/approve`)
      .set('Authorization', `Bearer ${hrToken}`)
      .send({ comment: 'Self approval attempt' })
      .expect(403);

    // Owner approves HR leave request
    const ownerApproveHr = await request(app.getHttpServer())
      .post(`/approvals/${hrRequestId}/approve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ comment: 'Owner approved HR request' })
      .expect(200);

    expect(ownerApproveHr.body.status).toBe('approved');

    // -------------------------------------------------------------------------
    // Step 19: Carry-Forward Preview & Execution
    // -------------------------------------------------------------------------
    // Allocate 2027 balances first so carry-forward target rows exist
    await request(app.getHttpServer())
      .post('/balances/allocate')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        year: 2027,
      })
      .expect(200);

    const previewCfRes = await request(app.getHttpServer())
      .post('/balances/carry-forward/preview')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        fromYear: 2026,
      })
      .expect(200);

    expect(previewCfRes.body.items).toBeDefined();

    const runCfRes = await request(app.getHttpServer())
      .post('/balances/carry-forward/run')
      .set('Authorization', `Bearer ${hrToken}`)
      .send({
        fromYear: 2026,
      })
      .expect(200);

    expect(runCfRes.body.message).toContain('successfully');
    expect(runCfRes.body.toYear).toBe(2027);

    // -------------------------------------------------------------------------
    // Step 20: Owner Transfers Ownership to HR Administrator
    // -------------------------------------------------------------------------
    const transferRes = await request(app.getHttpServer())
      .post('/org/transfer-ownership')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        newOwnerUserId: hrUserId,
        currentPassword: 'OwnerPerm123!',
      })
      .expect(200);

    expect(transferRes.body.message).toContain('transferred');

    // Old owner's token is immediately revoked (role changed / tokens invalidated)
    await request(app.getHttpServer())
      .get('/org/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);

    // -------------------------------------------------------------------------
    // Step 21: Platform Root Suspends Organization -> All Sessions Blocked
    // -------------------------------------------------------------------------
    const suspendRes = await request(app.getHttpServer())
      .patch(`/platform/organizations/${orgId}/suspend`)
      .set('Authorization', `Bearer ${rootToken}`)
      .send({ reason: 'Compliance audit suspension' })
      .expect(200);

    expect(suspendRes.body.organization.status).toBe('suspended');

    // Existing active manager token is immediately rejected with 401 or 403
    const blockedCall = await request(app.getHttpServer())
      .get('/team/availability/today')
      .set('Authorization', `Bearer ${managerToken}`);

    expect([401, 403]).toContain(blockedCall.status);

    // New logins for tenant users in suspended org are blocked
    const blockedLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'staff1@horizon.com', password: 'StaffPerm123!' });

    expect([401, 403]).toContain(blockedLogin.status);
    expect(blockedLogin.body.message).toBe('Organization is suspended');
  });
});
