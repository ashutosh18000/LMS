import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { OrgStatus, Prisma, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { AuditAction } from '../src/audit/audit.service';
import { BalancesService } from '../src/balances/balances.service';
import { cleanTestDatabase } from './test-helpers';

dotenv.config();

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Balances Module E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let balancesService: BalancesService;

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
    balancesService = app.get<BalancesService>(BalancesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(prisma);
  });

  async function createOrgAndHrAdmin(
    orgName = 'Acme Corp',
    hrEmail = 'hr@acme.com',
  ): Promise<{ org: any; hrUser: any; token: string }> {
    const org = await prisma.organization.create({
      data: {
        name: orgName,
        status: OrgStatus.active,
        financialYearStartMonth: 4, // April
      },
    });

    const hash = await passwordService.hash('HrAdmin123!');
    const hrUser = await prisma.user.create({
      data: {
        orgId: org.id,
        email: hrEmail.toLowerCase().trim(),
        name: 'HR Admin',
        passwordHash: hash,
        role: Role.hr_admin,
        mustChangePassword: false,
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: hrEmail, password: 'HrAdmin123!' });

    return { org, hrUser, token: loginRes.body.accessToken };
  }

  async function createStaffAndToken(
    orgId: string,
    email = 'staff@acme.com',
  ): Promise<{ user: any; token: string }> {
    const hash = await passwordService.hash('StaffPass123!');
    const user = await prisma.user.create({
      data: {
        orgId,
        email: email.toLowerCase().trim(),
        name: 'Test Staff',
        passwordHash: hash,
        role: Role.staff,
        mustChangePassword: false,
        active: true,
        joiningDate: new Date('2026-04-01T00:00:00.000Z'),
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'StaffPass123!' });

    return { user, token: loginRes.body.accessToken };
  }

  // ===========================================================================
  // 1. ALLOCATE BALANCES
  // ===========================================================================
  describe('POST /balances/allocate', () => {
    it('allocates balances for eligible roles, skips owner and WFH, and is idempotent', async () => {
      const { org, hrUser, token: hrToken } = await createOrgAndHrAdmin();
      const { user: staff } = await createStaffAndToken(org.id);

      // Create an Org Owner (ineligible for leave balance)
      const ownerHash = await passwordService.hash('OwnerPass123!');
      await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'owner@acme.com',
          name: 'Org Owner',
          passwordHash: ownerHash,
          role: Role.org_owner,
          active: true,
        },
      });

      // Create Paid Leave type (eligible)
      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Paid Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(18),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Create WFH type (ineligible: deductsBalance = false)
      await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Work From Home',
          paid: true,
          deductsBalance: false,
          halfDayAllowed: true,
          active: true,
        },
      });

      // Dry run first
      const dryRunRes = await request(app.getHttpServer())
        .post('/balances/allocate')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ year: 2026, dryRun: true });

      expect(dryRunRes.status).toBe(200);
      expect(dryRunRes.body.created).toBe(2); // hrUser + staff
      expect(dryRunRes.body.items).toHaveLength(2);

      // Verify no rows were actually created in DB
      const countBefore = await prisma.leaveBalance.count({
        where: { orgId: org.id },
      });
      expect(countBefore).toBe(0);

      // Actual allocation run
      const actualRes = await request(app.getHttpServer())
        .post('/balances/allocate')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ year: 2026 });

      expect(actualRes.status).toBe(200);
      expect(actualRes.body.created).toBe(2);
      expect(actualRes.body.skipped).toBe(0);

      const countAfter = await prisma.leaveBalance.count({
        where: { orgId: org.id },
      });
      expect(countAfter).toBe(2);

      // Idempotent rerun: created should be 0, skipped should be 2
      const rerunRes = await request(app.getHttpServer())
        .post('/balances/allocate')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ year: 2026 });

      expect(rerunRes.status).toBe(200);
      expect(rerunRes.body.created).toBe(0);
      expect(rerunRes.body.skipped).toBe(2);

      // Audit log entry verified
      const auditLogs = await prisma.auditLog.findMany({
        where: { orgId: org.id, action: AuditAction.BALANCES_ALLOCATED },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it('allocates prorated balance automatically when a new user is created via POST /users hook', async () => {
      const { org, hrUser, token: hrToken } = await createOrgAndHrAdmin();

      // Create leave type first
      await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Casual Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(12),
          halfDayAllowed: true,
          active: true,
        },
      });

      // HR creates staff who joined on 2026-10-15 (6 months remaining in April financial year)
      const userRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          name: 'Mid Year Joiner',
          email: 'midyear@acme.com',
          role: 'staff',
          joiningDate: '2026-10-15',
          tempPassword: 'Password123!',
        });

      expect(userRes.status).toBe(201);
      const newUserId = userRes.body.id;

      // Check that balance row was created automatically via hook
      const balance = await prisma.leaveBalance.findFirst({
        where: { userId: newUserId, year: 2026 },
      });

      expect(balance).toBeDefined();
      // 12 days * 6 / 12 = 6.0
      expect(balance!.allocated.toNumber()).toBe(6.0);
    });
  });

  // ===========================================================================
  // 2. ADJUST BALANCES
  // ===========================================================================
  describe('POST /balances/adjust', () => {
    it('applies positive and negative adjustments, writes audit log, and rejects negative available', async () => {
      const { org, hrUser, token: hrToken } = await createOrgAndHrAdmin();
      const { user: staff } = await createStaffAndToken(org.id);

      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Paid Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(15),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Initial allocate
      await request(app.getHttpServer())
        .post('/balances/allocate')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ year: 2026 });

      // Positive adjustment: +2.5
      const posRes = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          delta: 2.5,
          reason: 'Overtime bonus leave',
        });

      expect(posRes.status).toBe(200);
      expect(Number(posRes.body.allocated)).toBe(17.5);
      expect(Number(posRes.body.available)).toBe(17.5);
      expect(posRes.body.adjustment.reason).toBe('Overtime bonus leave');

      // Negative adjustment: -5.0
      const negRes = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          delta: -5.0,
          reason: 'Adjustment deduction',
        });

      expect(negRes.status).toBe(200);
      expect(Number(negRes.body.allocated)).toBe(12.5);

      // Negative adjustment that would make available balance negative -> 409 Conflict
      const excessNegRes = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          delta: -20.0,
          reason: 'Excessive deduction',
        });

      expect(excessNegRes.status).toBe(409);
      expect(excessNegRes.body.message).toContain('negative');

      // Verify adjustment history in GET /users/:id/balances
      const userBalRes = await request(app.getHttpServer())
        .get(`/users/${staff.id}/balances?year=2026`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(userBalRes.status).toBe(200);
      expect(userBalRes.body.balances[0].adjustments).toHaveLength(2);
    });

    it('rejects adjustment if reason is missing or delta is 0', async () => {
      const { token: hrToken } = await createOrgAndHrAdmin();

      const zeroDeltaRes = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: '00000000-0000-0000-0000-000000000000',
          leaveTypeId: '00000000-0000-0000-0000-000000000000',
          year: 2026,
          delta: 0,
          reason: 'No change',
        });
      expect(zeroDeltaRes.status).toBe(400);

      const noReasonRes = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: '00000000-0000-0000-0000-000000000000',
          leaveTypeId: '00000000-0000-0000-0000-000000000000',
          year: 2026,
          delta: 1,
          reason: '',
        });
      expect(noReasonRes.status).toBe(400);
    });
  });

  // ===========================================================================
  // 3. BALANCE PRIMITIVES & CONCURRENCY
  // ===========================================================================
  describe('Balance Primitives & Concurrency', () => {
    it('reserve, release, commit, and refund calculate correctly', async () => {
      const { org } = await createOrgAndHrAdmin();
      const { user: staff } = await createStaffAndToken(org.id);

      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Annual Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(10),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Create initial balance with allocated = 10, used = 0, pending = 0
      const balance = await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocated: new Prisma.Decimal(10),
          used: new Prisma.Decimal(0),
          pending: new Prisma.Decimal(0),
        },
      });

      // 1. Reserve 3 days
      await prisma.$transaction(async (tx) => {
        const res = await balancesService.reserve(tx, staff.id, pl.id, 2026, 3);
        expect(Number(res.pending)).toBe(3);
        expect(Number(res.used)).toBe(0);
      });

      // 2. Commit 2 days (request approved) -> pending = 1, used = 2
      await prisma.$transaction(async (tx) => {
        const res = await balancesService.commit(tx, staff.id, pl.id, 2026, 2);
        expect(Number(res.pending)).toBe(1);
        expect(Number(res.used)).toBe(2);
      });

      // 3. Release 1 remaining day (request rejected or partial cancel) -> pending = 0, used = 2
      await prisma.$transaction(async (tx) => {
        const res = await balancesService.release(tx, staff.id, pl.id, 2026, 1);
        expect(Number(res.pending)).toBe(0);
        expect(Number(res.used)).toBe(2);
      });

      // 4. Refund 2 days (approved request cancelled) -> used = 0
      await prisma.$transaction(async (tx) => {
        const res = await balancesService.refund(tx, staff.id, pl.id, 2026, 2);
        expect(Number(res.used)).toBe(0);
        expect(Number(res.pending)).toBe(0);
      });
    });

    it('throws INVARIANT_VIOLATION when release/commit exceeds pending, or refund exceeds used', async () => {
      const { org } = await createOrgAndHrAdmin();
      const { user: staff } = await createStaffAndToken(org.id);

      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Paid Leave Strict',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(10),
          halfDayAllowed: true,
          active: true,
        },
      });

      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocated: new Prisma.Decimal(10),
          used: new Prisma.Decimal(2),
          pending: new Prisma.Decimal(1),
        },
      });

      // 1. Release 2 days when pending is 1 -> throws INVARIANT_VIOLATION
      await expect(
        prisma.$transaction(async (tx) => {
          return balancesService.release(tx, staff.id, pl.id, 2026, 2);
        }),
      ).rejects.toThrow('INVARIANT_VIOLATION');

      // 2. Commit 2 days when pending is 1 -> throws INVARIANT_VIOLATION
      await expect(
        prisma.$transaction(async (tx) => {
          return balancesService.commit(tx, staff.id, pl.id, 2026, 2);
        }),
      ).rejects.toThrow('INVARIANT_VIOLATION');

      // 3. Refund 3 days when used is 2 -> throws INVARIANT_VIOLATION
      await expect(
        prisma.$transaction(async (tx) => {
          return balancesService.refund(tx, staff.id, pl.id, 2026, 3);
        }),
      ).rejects.toThrow('INVARIANT_VIOLATION');
    });

    it('concurrency test: 5 concurrent reserve calls for 1 day when only 3 days are available: exactly 3 succeed, 2 fail', async () => {
      const { org } = await createOrgAndHrAdmin();
      const { user: staff } = await createStaffAndToken(org.id);

      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Concurrent Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(3),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Exactly 3 days allocated
      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocated: new Prisma.Decimal(3),
          used: new Prisma.Decimal(0),
          pending: new Prisma.Decimal(0),
        },
      });

      // Launch 5 parallel reserve calls for 1 day each
      const promises = Array.from({ length: 5 }, () =>
        prisma.$transaction(async (tx) => {
          return balancesService.reserve(tx, staff.id, pl.id, 2026, 1);
        }),
      );

      const results = await Promise.allSettled(promises);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      // Exactly 3 must succeed and exactly 2 must fail!
      expect(successes).toHaveLength(3);
      expect(failures).toHaveLength(2);

      // Verify database state: pending must be exactly 3, available must be 0, never negative
      const finalBalance = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: pl.id,
            year: 2026,
          },
        },
      });

      expect(Number(finalBalance!.pending)).toBe(3);
      expect(Number(finalBalance!.used)).toBe(0);
      const available = finalBalance!.allocated
        .minus(finalBalance!.used)
        .minus(finalBalance!.pending);
      expect(Number(available)).toBe(0);
    });
  });

  // ===========================================================================
  // 4. CARRY FORWARD
  // ===========================================================================
  describe('Carry-Forward (Preview & Run)', () => {
    it('previews accurately, enforces carryForwardMax cap, and runs atomically', async () => {
      const { org, hrUser, token: hrToken } = await createOrgAndHrAdmin();
      const { user: staff } = await createStaffAndToken(org.id);

      // Leave type with carryForwardMax = 5.0
      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Paid Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(15),
          carryForwardMax: new Prisma.Decimal(5),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Create fromYear (2025) balance: allocated = 15, used = 5, pending = 2 -> available = 8
      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2025,
          allocated: new Prisma.Decimal(15),
          used: new Prisma.Decimal(5),
          pending: new Prisma.Decimal(2),
        },
      });

      // Preview before toYear allocation exists -> should flag "toYear allocation missing"
      const previewBeforeAlloc = await request(app.getHttpServer())
        .post('/balances/carry-forward/preview')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ fromYear: 2025 });

      expect(previewBeforeAlloc.status).toBe(200);
      expect(previewBeforeAlloc.body.pendingWarningCount).toBe(1);
      const staffItem = previewBeforeAlloc.body.items.find(
        (i: any) => i.userId === staff.id,
      );
      expect(staffItem.skippedReason).toBe('toYear allocation missing');
      expect(Number(staffItem.available)).toBe(8.0);
      expect(Number(staffItem.carry)).toBe(5.0); // Capped by carryForwardMax (5.0)

      // Run before toYear allocation exists -> MUST fail with 409 Conflict
      const runBeforeAlloc = await request(app.getHttpServer())
        .post('/balances/carry-forward/run')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ fromYear: 2025 });
      expect(runBeforeAlloc.status).toBe(409);
      expect(runBeforeAlloc.body.message).toContain('toYear ki allocation chalao');

      // Now create toYear (2026) allocation for eligible employees
      const toYearBalance = await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocated: new Prisma.Decimal(15),
          used: new Prisma.Decimal(0),
          pending: new Prisma.Decimal(0),
        },
      });

      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: hrUser.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocated: new Prisma.Decimal(15),
          used: new Prisma.Decimal(0),
          pending: new Prisma.Decimal(0),
        },
      });

      // Run carry-forward
      const runSuccess = await request(app.getHttpServer())
        .post('/balances/carry-forward/run')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ fromYear: 2025 });

      expect(runSuccess.status).toBe(200);
      expect(runSuccess.body.totalRows).toBe(1);
      expect(Number(runSuccess.body.totalDays)).toBe(5.0);

      // Verify toYear balance was incremented by 5.0 -> allocated = 20.0
      const updatedToYear = await prisma.leaveBalance.findUnique({
        where: { id: toYearBalance.id },
      });
      expect(Number(updatedToYear!.allocated)).toBe(20.0);

      // Verify BalanceAdjustment row was created
      const adjustment = await prisma.balanceAdjustment.findFirst({
        where: { balanceId: toYearBalance.id },
      });
      expect(adjustment).toBeDefined();
      expect(adjustment!.reason).toBe('Carry-forward from 2025');
      expect(Number(adjustment!.delta)).toBe(5.0);

      // Running carry-forward second time for same fromYear -> MUST return 409 Conflict
      const secondRun = await request(app.getHttpServer())
        .post('/balances/carry-forward/run')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ fromYear: 2025 });
      expect(secondRun.status).toBe(409);
      expect(secondRun.body.message).toContain('already been executed');
    });
  });

  // ===========================================================================
  // 5. PERSONAL BALANCES (/me/balances)
  // ===========================================================================
  describe('GET /me/balances', () => {
    it('returns only caller balances and includes WFH with monthlyLimit and usedThisMonth = 0', async () => {
      const { org } = await createOrgAndHrAdmin();
      const { user: staff, token: staffToken } = await createStaffAndToken(org.id);

      // Create Paid Leave
      const pl = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Casual Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(12),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Create WFH with monthlyLimit = 4.0
      await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Work From Home',
          paid: true,
          deductsBalance: false,
          monthlyLimit: new Prisma.Decimal(4),
          halfDayAllowed: true,
          active: true,
        },
      });

      // Create balance row for Casual Leave
      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: pl.id,
          year: 2026,
          allocated: new Prisma.Decimal(12),
          used: new Prisma.Decimal(2),
          pending: new Prisma.Decimal(1),
        },
      });

      const meRes = await request(app.getHttpServer())
        .get('/me/balances?year=2026')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.items).toHaveLength(2);

      const casualItem = meRes.body.items.find(
        (i: any) => i.leaveTypeName === 'Casual Leave',
      );
      expect(casualItem.allocated).toBe('12');
      expect(casualItem.used).toBe('2');
      expect(casualItem.pending).toBe('1');
      expect(casualItem.available).toBe('9');

      const wfhItem = meRes.body.items.find(
        (i: any) => i.leaveTypeName === 'Work From Home',
      );
      expect(wfhItem.deductsBalance).toBe(false);
      expect(wfhItem.allocated).toBeNull();
      expect(wfhItem.monthlyLimit).toBe('4');
      expect(Number(wfhItem.usedThisMonth)).toBe(0);
    });
  });

  // ===========================================================================
  // 6. TENANT ISOLATION, RBAC & ORG SETTINGS
  // ===========================================================================
  describe('Tenant Isolation, RBAC & Settings Protection', () => {
    it('prevents HR Admin of Org A from accessing or adjusting Org B balances (404)', async () => {
      const { token: hrA } = await createOrgAndHrAdmin('Org A', 'hr.a@orga.com');
      const { org: orgB, hrUser: hrB } = await createOrgAndHrAdmin(
        'Org B',
        'hr.b@orgb.com',
      );

      const plB = await prisma.leaveType.create({
        data: {
          orgId: orgB.id,
          name: 'Org B Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(10),
          halfDayAllowed: true,
          active: true,
        },
      });

      // HR A attempts to adjust Org B user balance -> 404
      const crossAdjust = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${hrA}`)
        .send({
          userId: hrB.id,
          leaveTypeId: plB.id,
          year: 2026,
          delta: 2,
          reason: 'Cross tenant attempt',
        });

      expect(crossAdjust.status).toBe(404);

      // HR A attempts to view Org B user balances -> 404
      const crossView = await request(app.getHttpServer())
        .get(`/users/${hrB.id}/balances?year=2026`)
        .set('Authorization', `Bearer ${hrA}`);

      expect(crossView.status).toBe(404);
    });

    it('rejects staff user from calling management endpoints (403 Forbidden)', async () => {
      const { org } = await createOrgAndHrAdmin();
      const { token: staffToken } = await createStaffAndToken(org.id);

      const allocRes = await request(app.getHttpServer())
        .post('/balances/allocate')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ year: 2026 });
      expect(allocRes.status).toBe(403);

      const adjustRes = await request(app.getHttpServer())
        .post('/balances/adjust')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          userId: '00000000-0000-0000-0000-000000000000',
          leaveTypeId: '00000000-0000-0000-0000-000000000000',
          year: 2026,
          delta: 1,
          reason: 'Unauthorized attempt',
        });
      expect(adjustRes.status).toBe(403);

      const cfRunRes = await request(app.getHttpServer())
        .post('/balances/carry-forward/run')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ fromYear: 2025 });
      expect(cfRunRes.status).toBe(403);
    });

    it('blocks changing financialYearStartMonth in PATCH /org/settings with 409 if LeaveBalance rows exist', async () => {
      const { org, hrUser } = await createOrgAndHrAdmin();

      // Create owner user to call /org/settings
      const hash = await passwordService.hash('OwnerPass123!');
      const owner = await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'owner.settings@acme.com',
          name: 'Org Owner',
          passwordHash: hash,
          role: Role.org_owner,
          mustChangePassword: false,
          active: true,
        },
      });

      const ownerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner.settings@acme.com', password: 'OwnerPass123!' });
      const ownerToken = ownerLogin.body.accessToken;

      // 1. Changing financialYearStartMonth succeeds when 0 balance rows exist
      const okRes = await request(app.getHttpServer())
        .patch('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ financialYearStartMonth: 1 });
      expect(okRes.status).toBe(200);

      // 2. Create a leave balance row
      const lt = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          name: 'Annual Quota',
          paid: true,
          deductsBalance: true,
          daysPerYear: new Prisma.Decimal(10),
          halfDayAllowed: true,
          active: true,
        },
      });

      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: hrUser.id,
          leaveTypeId: lt.id,
          year: 2026,
          allocated: new Prisma.Decimal(10),
          used: new Prisma.Decimal(0),
          pending: new Prisma.Decimal(0),
        },
      });

      // 3. Changing financialYearStartMonth now MUST fail with 409 Conflict
      const blockedRes = await request(app.getHttpServer())
        .patch('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ financialYearStartMonth: 4 });

      expect(blockedRes.status).toBe(409);
      expect(blockedRes.body.message).toContain(
        'Balances maujood hain, financial year start nahi badal sakte',
      );
    });
  });
});
