import * as path from "path";
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { OrgStatus, Portion, Prisma, RequestStatus, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { BalancesService } from '../src/balances/balances.service';
import { ClockService } from '../src/common/services/clock.service';
import { AuditAction } from '../src/audit/audit.service';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Approvals & On-Behalf Module E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let balancesService: BalancesService;
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
    balancesService = app.get<BalancesService>(BalancesService);
    clockService = app.get<ClockService>(ClockService);
  });

  afterAll(async () => {
    clockService.setFixedToday(null);
    await app.close();
  });

  beforeEach(async () => {
    clockService.setFixedToday('2026-11-01');
    await cleanTestDatabase(prisma);
  });

  afterEach(async () => {
    // Invariant check: pending >= 0, used >= 0, pending <= allocated - used
    const balances = await prisma.leaveBalance.findMany();
    for (const b of balances) {
      const allocated = Number(b.allocated);
      const used = Number(b.used);
      const pending = Number(b.pending);

      expect(pending).toBeGreaterThanOrEqual(0);
      expect(used).toBeGreaterThanOrEqual(0);
      expect(pending).toBeLessThanOrEqual(allocated - used);
    }
  });

  // Helpers
  async function createOrg(
    name = 'Acme Corp',
    extra?: Partial<Prisma.OrganizationCreateInput>,
  ) {
    return prisma.organization.create({
      data: {
        name,
        status: OrgStatus.active,
        financialYearStartMonth: 4, // April
        timezone: 'Asia/Kolkata',
        backdateAllowedDays: 7,
        workingDays: [1, 2, 3, 4, 5], // Mon - Fri
        ...extra,
      },
    });
  }

  async function createUserAndToken(
    orgId: string | null,
    role: Role,
    email: string,
    opts?: { name?: string; department?: string; managerId?: string },
    password = 'Password123!',
  ): Promise<{ user: any; token: string }> {
    const hash = await passwordService.hash(password);
    const user = await prisma.user.create({
      data: {
        orgId,
        email: email.toLowerCase().trim(),
        name: opts?.name ?? `${role} User`,
        passwordHash: hash,
        role,
        department: opts?.department ?? 'Engineering',
        managerId: opts?.managerId,
        mustChangePassword: false,
        active: true,
        joiningDate: new Date('2026-04-01T00:00:00.000Z'),
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    return { user, token: loginRes.body.accessToken };
  }

  async function createLeaveType(
    orgId: string,
    opts: {
      name: string;
      paid?: boolean;
      deductsBalance?: boolean;
      isWfh?: boolean;
      daysPerYear?: number;
      monthlyLimit?: number | null;
      halfDayAllowed?: boolean;
      minNoticeDays?: number;
    },
  ) {
    return prisma.leaveType.create({
      data: {
        orgId,
        name: opts.name,
        paid: opts.paid ?? true,
        deductsBalance: opts.deductsBalance ?? true,
        isWfh: opts.isWfh ?? false,
        daysPerYear: opts.daysPerYear ?? 12,
        monthlyLimit: opts.monthlyLimit ?? null,
        halfDayAllowed: opts.halfDayAllowed ?? true,
        minNoticeDays: opts.minNoticeDays ?? 0,
        active: true,
      },
    });
  }

  async function setLeaveBalance(
    userId: string,
    leaveTypeId: string,
    year: number,
    allocated: number,
    used = 0,
    pending = 0,
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return prisma.leaveBalance.create({
      data: {
        orgId: user!.orgId!,
        userId,
        leaveTypeId,
        year,
        allocated: new Prisma.Decimal(allocated),
        used: new Prisma.Decimal(used),
        pending: new Prisma.Decimal(pending),
      },
    });
  }

  // ===========================================================================
  // 1. APPROVAL WORKFLOW (POST /approvals/:id/approve)
  // ===========================================================================
  describe('POST /approvals/:id/approve', () => {
    it('approves a pending request, commits balance from pending to used, and logs LEAVE_APPROVED audit', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // Staff applies for 2026-11-02 to 2026-11-04 (3 days)
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Family wedding',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(applyRes.status).toBe(201);
      const reqId = applyRes.body.id;

      // Pending balance before approval: pending = 3, used = 0
      let bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(3);
      expect(Number(bal?.used)).toBe(0);

      // HR approves with comment
      const approveRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'Approved, have fun!' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe(RequestStatus.approved);

      // Verify request state in DB
      const updatedReq = await prisma.leaveRequest.findUnique({
        where: { id: reqId },
      });
      expect(updatedReq?.status).toBe(RequestStatus.approved);
      expect(updatedReq?.decidedBy).toBe(hr.id);
      expect(updatedReq?.decidedAt).toBeDefined();
      expect(updatedReq?.decisionComment).toBe('Approved, have fun!');

      // Verify committed balance: pending = 0, used = 3
      bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(0);
      expect(Number(bal?.used)).toBe(3);

      // Verify Audit Log
      const audit = await prisma.auditLog.findFirst({
        where: {
          orgId: org.id,
          action: AuditAction.LEAVE_APPROVED,
          targetUserId: staff.id,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(hr.id);
      expect(audit?.metadata).toMatchObject({
        requestId: reqId,
        requesterId: staff.id,
      });
    });

    it('blocks subsequent approval or rejection on an already approved request with 409', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Doctor checkup',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // First approve
      await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send();

      // Second approve -> 409
      const secondApprove = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send();
      expect(secondApprove.status).toBe(409);

      // Attempt to reject -> 409
      const rejectAttempt = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/reject`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'Changed mind' });
      expect(rejectAttempt.status).toBe(409);
    });
  });

  // ===========================================================================
  // 2. REJECTION WORKFLOW (POST /approvals/:id/reject)
  // ===========================================================================
  describe('POST /approvals/:id/reject', () => {
    it('requires comment, releases balance, marks request final, and allows staff to reapply', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Road trip',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // 1. Reject without comment -> 400 Bad Request
      const noCommentRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/reject`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({});
      expect(noCommentRes.status).toBe(400);

      // 2. Reject with comment -> 200 OK
      const rejectRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/reject`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'High project workload this week, please postpone' });
      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe(RequestStatus.rejected);

      // Balance released: pending = 0, used = 0
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(0);
      expect(Number(bal?.used)).toBe(0);

      // Audit log LEAVE_REJECTED
      const audit = await prisma.auditLog.findFirst({
        where: {
          orgId: org.id,
          action: AuditAction.LEAVE_REJECTED,
          targetUserId: staff.id,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(hr.id);

      // Request is final: cannot approve rejected request
      const approveAttempt = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send();
      expect(approveAttempt.status).toBe(409);

      // Staff can re-apply on the same dates
      const reapplyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Road trip revised',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(reapplyRes.status).toBe(201);
    });
  });

  // ===========================================================================
  // 3. DECISION PERMISSION RULES (canDecide)
  // ===========================================================================
  describe('Decision Permission Rule (canDecide)', () => {
    it('prevents user from deciding on own request with 403', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(hr.id, cl.id, 2026, 10, 0, 0);

      // HR applies for leave
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          reason: 'Personal day',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // HR attempts to approve own request -> 403
      const approveRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send();
      expect(approveRes.status).toBe(403);

      // HR attempts to reject own request -> 403
      const rejectRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/reject`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'Cancel self' });
      expect(rejectRes.status).toBe(403);
    });

    it('forbids an HR Admin from deciding another HR Admin request with 403 / 404', async () => {
      const org = await createOrg();
      const { user: hr1, token: hr1Token } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr1@acme.com',
      );
      const { token: hr2Token } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr2@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(hr1.id, cl.id, 2026, 10, 0, 0);

      // HR1 applies
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${hr1Token}`)
        .send({
          reason: 'HR1 trip',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // HR2 attempts to approve HR1's request -> 403
      const approveRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hr2Token}`)
        .send();
      expect(approveRes.status).toBe(403);

      // HR2 viewing detail -> 404
      const detailRes = await request(app.getHttpServer())
        .get(`/approvals/${reqId}`)
        .set('Authorization', `Bearer ${hr2Token}`);
      expect(detailRes.status).toBe(404);
    });

    it('allows Org Owner to approve HR Admin leave request', async () => {
      const org = await createOrg();
      const { user: owner, token: ownerToken } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(hr.id, cl.id, 2026, 10, 0, 0);

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          reason: 'HR annual leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // Owner approves HR Admin request -> 200 OK
      const approveRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ comment: 'Approved by Owner' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe(RequestStatus.approved);
    });

    it('forbids staff and manager from accessing approvals endpoints with 403', async () => {
      const org = await createOrg();
      const { token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );
      const { token: managerToken } = await createUserAndToken(
        org.id,
        Role.manager,
        'manager@acme.com',
      );

      // Staff access
      const resStaff = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(resStaff.status).toBe(403);

      // Manager access
      const resManager = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(resManager.status).toBe(403);
    });
  });

  // ===========================================================================
  // 4. PENDING INBOX (GET /approvals/pending)
  // ===========================================================================
  describe('GET /approvals/pending', () => {
    it('returns pending requests sorted oldest first, filtering by caller authority and onlyHrAdmins', async () => {
      const org = await createOrg();
      const { user: owner, token: ownerToken } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);
      await setLeaveBalance(hr.id, cl.id, 2026, 10, 0, 0);

      // Staff applies first (1 Nov)
      clockService.setFixedToday('2026-11-01');
      await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Staff leave 1',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });

      // HR applies second (2 Nov)
      clockService.setFixedToday('2026-11-02');
      await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          reason: 'HR leave 2',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-05',
              endDate: '2026-11-05',
              portion: Portion.full,
            },
          ],
        });

      // 1. HR views inbox: sees Staff leave, does NOT see HR leave
      const hrInbox = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(hrInbox.status).toBe(200);
      expect(hrInbox.body.total).toBe(1);
      expect(hrInbox.body.items[0].reason).toBe('Staff leave 1');

      // 2. Owner views inbox: sees both Staff and HR requests
      const ownerInbox = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(ownerInbox.status).toBe(200);
      expect(ownerInbox.body.total).toBe(2);
      expect(ownerInbox.body.items[0].reason).toBe('Staff leave 1'); // Oldest first
      expect(ownerInbox.body.items[1].reason).toBe('HR leave 2');

      // 3. Owner views with ?onlyHrAdmins=true -> returns ONLY HR leave
      const onlyHr = await request(app.getHttpServer())
        .get('/approvals/pending?onlyHrAdmins=true')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(onlyHr.status).toBe(200);
      expect(onlyHr.body.total).toBe(1);
      expect(onlyHr.body.items[0].reason).toBe('HR leave 2');
    });

    it('enforces tenant isolation: Org B HR cannot see Org A pending requests', async () => {
      const orgA = await createOrg('Org A');
      const orgB = await createOrg('Org B');

      const { user: staffA, token: tokenStaffA } = await createUserAndToken(
        orgA.id,
        Role.staff,
        'staff@orga.com',
      );
      const { token: tokenHrB } = await createUserAndToken(
        orgB.id,
        Role.hr_admin,
        'hr@orgb.com',
      );

      const clA = await createLeaveType(orgA.id, { name: 'Casual Leave' });
      await setLeaveBalance(staffA.id, clA.id, 2026, 10, 0, 0);

      await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaffA}`)
        .send({
          reason: 'Org A leave',
          segments: [
            {
              leaveTypeId: clA.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });

      // Org B HR checks inbox
      const res = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set('Authorization', `Bearer ${tokenHrB}`);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });
  });

  // ===========================================================================
  // 5. DETAIL CONTEXT (GET /approvals/:id)
  // ===========================================================================
  describe('GET /approvals/:id - Detail & Context', () => {
    it('returns balances, monthlyUsage, and teamConflicts accurately', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );

      // Manager and 2 team members
      const { user: manager } = await createUserAndToken(
        org.id,
        Role.manager,
        'mgr@acme.com',
        { department: 'Engineering' },
      );
      const { user: staff1, token: tokenStaff1 } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff1@acme.com',
        { department: 'Engineering', managerId: manager.id },
      );
      const { user: staff2, token: tokenStaff2 } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff2@acme.com',
        { department: 'Engineering', managerId: manager.id },
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      const wfh = await createLeaveType(org.id, {
        name: 'Work From Home',
        deductsBalance: false,
        isWfh: true,
        monthlyLimit: 4,
      });

      await setLeaveBalance(staff1.id, cl.id, 2026, 10, 0, 0);
      await setLeaveBalance(staff2.id, cl.id, 2026, 10, 0, 0);

      // Staff 2 already has an approved leave on 2026-11-03
      const staff2Apply = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaff2}`)
        .send({
          reason: 'Colleague leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
          ],
        });
      await request(app.getHttpServer())
        .post(`/approvals/${staff2Apply.body.id}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send();

      // Staff 1 applies for WFH on 2026-11-03 and 2026-11-04
      const staff1Apply = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaff1}`)
        .send({
          reason: 'Remote work sprint',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-03',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      const staff1ReqId = staff1Apply.body.id;

      // HR queries approval detail
      const res = await request(app.getHttpServer())
        .get(`/approvals/${staff1ReqId}`)
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(staff1ReqId);
      expect(res.body.context).toBeDefined();

      // Monthly usage
      expect(res.body.context.monthlyUsage).toHaveLength(1);
      expect(res.body.context.monthlyUsage[0].monthlyLimit).toBe(4);
      expect(res.body.context.monthlyUsage[0].usedThisMonth).toBe(2);

      // Team conflicts: Staff 2 on 2026-11-03
      expect(res.body.context.teamConflicts).toHaveLength(1);
      expect(res.body.context.teamConflicts[0].userId).toBe(staff2.id);
      expect(res.body.context.teamConflicts[0].date).toBe('2026-11-03');
      expect(res.body.context.teamConflicts[0].status).toBe(RequestStatus.approved);
      // Requester themselves must NOT be in teamConflicts
      expect(
        res.body.context.teamConflicts.some((c: any) => c.userId === staff1.id),
      ).toBe(false);
    });
  });

  // ===========================================================================
  // 6. RACES & CONCURRENCY
  // ===========================================================================
  describe('Concurrency & Race Conditions', () => {
    it('handles simultaneous approve and cancel (Promise.all): exactly 1 wins', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Race test leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // Simultaneous approve and user cancel
      const [approveRes, cancelRes] = await Promise.all([
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/approve`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send({ comment: 'Approved in race' }),
        request(app.getHttpServer())
          .post(`/leave-requests/${reqId}/cancel`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send(),
      ]);

      const statuses = [approveRes.status, cancelRes.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // Verify balance integrity: pending is 0
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(0);
      if (approveRes.status === 200) {
        expect(Number(bal?.used)).toBe(3);
      } else {
        expect(Number(bal?.used)).toBe(0);
      }
    });

    it('handles double simultaneous approve (Promise.all): exactly 1 succeeds, 1 returns 409', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Double approve test',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/approve`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send(),
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/approve`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send(),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);
    });

    it('handles simultaneous approve and reject (Promise.all): exactly 1 succeeds, 1 returns 409', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Approve vs Reject race',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      const [resApprove, resReject] = await Promise.all([
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/approve`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send(),
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/reject`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send({ comment: 'Reject in race' }),
      ]);

      const statuses = [resApprove.status, resReject.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);
    });
  });

  // ===========================================================================
  // 7. ON-BEHALF APPLICATION (POST /leave-requests/on-behalf)
  // ===========================================================================
  describe('POST /leave-requests/on-behalf', () => {
    it('bypasses backdate and notice, auto-approves by default, and commits balance directly', async () => {
      const org = await createOrg('Acme OnBehalf', { backdateAllowedDays: 2 });
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const el = await createLeaveType(org.id, {
        name: 'Earned Leave Strict',
        minNoticeDays: 5,
      });
      await setLeaveBalance(staff.id, el.id, 2026, 10, 0, 0);

      // Today is 2026-11-15.
      clockService.setFixedToday('2026-11-15');
      // Apply for 2026-11-05 (10 days back > backdateAllowedDays 2)
      // and 0 notice days < minNoticeDays 5.
      const res = await request(app.getHttpServer())
        .post('/leave-requests/on-behalf')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: staff.id,
          reason: 'Emergency hospitalisation',
          onBehalfReason: 'Approved by executive exception',
          autoApprove: true,
          segments: [
            {
              leaveTypeId: el.id,
              startDate: '2026-11-05',
              endDate: '2026-11-06',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(RequestStatus.approved);
      expect(res.body.decidedBy).toBe(hr.id);
      expect(res.body.createdBy).toBe(hr.id);
      expect(res.body.userId).toBe(staff.id);

      // Directly committed to used: pending = 0, used = 2
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: el.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(0);
      expect(Number(bal?.used)).toBe(2);

      // Audit log LEAVE_APPLIED_ON_BEHALF
      const audit = await prisma.auditLog.findFirst({
        where: {
          orgId: org.id,
          action: AuditAction.LEAVE_APPLIED_ON_BEHALF,
          targetUserId: staff.id,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.actorId).toBe(hr.id);
    });

    it('creates pending request when autoApprove is false and shows in approvals inbox', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const res = await request(app.getHttpServer())
        .post('/leave-requests/on-behalf')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: staff.id,
          reason: 'Special request',
          onBehalfReason: 'Drafted on behalf of employee for manager review',
          autoApprove: false,
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe(RequestStatus.pending);

      // Pending balance reserved: pending = 1, used = 0
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(1);
      expect(Number(bal?.used)).toBe(0);

      // Appears in approvals inbox
      const inbox = await request(app.getHttpServer())
        .get('/approvals/pending')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(inbox.body.total).toBe(1);
      expect(inbox.body.items[0].createdBy).toBe(hr.name);
    });

    it('forbids applying on-behalf for oneself with 403', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });

      const res = await request(app.getHttpServer())
        .post('/leave-requests/on-behalf')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          userId: hr.id,
          reason: 'Self on behalf',
          onBehalfReason: 'Trying to bypass',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(res.status).toBe(403);
    });

    it('forbids HR Admin from applying on behalf of another HR Admin (only Org Owner can)', async () => {
      const org = await createOrg();
      const { user: hr1, token: tokenHr1 } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr1@acme.com',
      );
      const { user: hr2 } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr2@acme.com',
      );
      const { token: tokenOwner } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(hr2.id, cl.id, 2026, 10, 0, 0);

      // HR1 applies for HR2 -> 403
      const resHr1 = await request(app.getHttpServer())
        .post('/leave-requests/on-behalf')
        .set('Authorization', `Bearer ${tokenHr1}`)
        .send({
          userId: hr2.id,
          reason: 'HR2 vacation',
          onBehalfReason: 'Peer applied',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(resHr1.status).toBe(403);

      // Owner applies for HR2 -> 201 OK
      const resOwner = await request(app.getHttpServer())
        .post('/leave-requests/on-behalf')
        .set('Authorization', `Bearer ${tokenOwner}`)
        .send({
          userId: hr2.id,
          reason: 'HR2 vacation approved by owner',
          onBehalfReason: 'Executive order',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(resOwner.status).toBe(201);
    });
  });

  // ===========================================================================
  // 8. HR CANCEL APPROVED LEAVE (POST /leave-requests/:id/cancel-approved)
  // ===========================================================================
  describe('POST /leave-requests/:id/cancel-approved', () => {
    it('refunds used balance, cancels request, preserves original decision comment, and frees dates', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // 1. Staff applies
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Family trip',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // 2. HR approves with comment
      await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ comment: 'Original HR Approval Comment' });

      // Verify used balance is 3
      let bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.used)).toBe(3);

      // 3. HR cancels approved leave with reason
      const cancelApprovedRes = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel-approved`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ reason: 'Client deployment postponed, leave rescinded by company' });

      expect(cancelApprovedRes.status).toBe(200);
      expect(cancelApprovedRes.body.status).toBe(RequestStatus.cancelled);

      // Verify DB record: cancelledAt set, but decisionComment preserved!
      const reqInDb = await prisma.leaveRequest.findUnique({ where: { id: reqId } });
      expect(reqInDb?.status).toBe(RequestStatus.cancelled);
      expect(reqInDb?.cancelledAt).toBeDefined();
      expect(reqInDb?.decisionComment).toBe('Original HR Approval Comment');

      // Balance refunded: used = 0, pending = 0
      bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.used)).toBe(0);
      expect(Number(bal?.pending)).toBe(0);

      // Audit log LEAVE_CANCELLED_BY_HR
      const audit = await prisma.auditLog.findFirst({
        where: {
          orgId: org.id,
          action: AuditAction.LEAVE_CANCELLED_BY_HR,
          targetUserId: staff.id,
        },
      });
      expect(audit).toBeDefined();
      expect(audit?.reason).toBe('Client deployment postponed, leave rescinded by company');

      // Dates freed: staff can re-apply on those exact dates
      const reapplyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Rescheduled trip',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(reapplyRes.status).toBe(201);
    });

    it('rejects cancelling pending or rejected requests with 409', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // Create pending request
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Pending leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;

      // Calling /cancel-approved on pending request -> 409
      const cancelPending = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel-approved`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ reason: 'Mistakenly tried' });
      expect(cancelPending.status).toBe(409);
    });

    it('forbids caller from cancelling their own approved leave with 403', async () => {
      const org = await createOrg();
      const { user: owner, token: ownerToken } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(hr.id, cl.id, 2026, 10, 0, 0);

      // HR applies, Owner approves
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          reason: 'HR Leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = applyRes.body.id;
      await request(app.getHttpServer())
        .post(`/approvals/${reqId}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send();

      // HR attempts to cancel own approved leave -> 403
      const selfCancelRes = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel-approved`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ reason: 'Self cancel' });
      expect(selfCancelRes.status).toBe(403);
    });
  });

  // ===========================================================================
  // 9. ORG LEAVE HISTORY (GET /leave-requests)
  // ===========================================================================
  describe('GET /leave-requests - Org-wide History', () => {
    it('returns paginated requests with filters, accessible by HR Admin+', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff1, token: tokenStaff1 } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff1@acme.com',
        { department: 'Engineering' },
      );
      const { user: staff2, token: tokenStaff2 } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff2@acme.com',
        { department: 'Design' },
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff1.id, cl.id, 2026, 10, 0, 0);
      await setLeaveBalance(staff2.id, cl.id, 2026, 10, 0, 0);

      // Staff 1 applies
      await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaff1}`)
        .send({
          reason: 'Eng leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });

      // Staff 2 applies
      await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaff2}`)
        .send({
          reason: 'Design leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-05',
              endDate: '2026-11-05',
              portion: Portion.full,
            },
          ],
        });

      // 1. Get all
      const allRes = await request(app.getHttpServer())
        .get('/leave-requests')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(allRes.status).toBe(200);
      expect(allRes.body.total).toBe(2);

      // 2. Filter by department
      const engRes = await request(app.getHttpServer())
        .get('/leave-requests?department=Engineering')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(engRes.status).toBe(200);
      expect(engRes.body.total).toBe(1);
      expect(engRes.body.items[0].reason).toBe('Eng leave');

      // 3. Staff access blocked
      const staffRes = await request(app.getHttpServer())
        .get('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaff1}`);
      expect(staffRes.status).toBe(403);
    });
  });

  // ===========================================================================
  // 10. DEACTIVATION HOOK
  // ===========================================================================
  describe('Deactivation Hook', () => {
    it('cancels all pending requests and releases reserved balance when user is deactivated, leaving approved leaves intact', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // 1. Approved request: 2026-11-02 to 2026-11-03 (2 days)
      const req1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'First request (to be approved)',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
          ],
        });
      await request(app.getHttpServer())
        .post(`/approvals/${req1.body.id}/approve`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send();

      // 2. Pending request: 2026-11-09 to 2026-11-10 (2 days)
      const req2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Second request (pending)',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-09',
              endDate: '2026-11-10',
              portion: Portion.full,
            },
          ],
        });

      // Before deactivation: pending = 2, used = 2
      let bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(2);
      expect(Number(bal?.used)).toBe(2);

      // 3. HR deactivates staff user
      const deactRes = await request(app.getHttpServer())
        .patch(`/users/${staff.id}/deactivate`)
        .set('Authorization', `Bearer ${hrToken}`);
      expect(deactRes.status).toBe(200);

      // 4. Verify request statuses
      const req1InDb = await prisma.leaveRequest.findUnique({ where: { id: req1.body.id } });
      const req2InDb = await prisma.leaveRequest.findUnique({ where: { id: req2.body.id } });

      expect(req1InDb?.status).toBe(RequestStatus.approved); // Approved untouched!
      expect(req2InDb?.status).toBe(RequestStatus.cancelled); // Pending cancelled!
      expect(req2InDb?.cancelledAt).toBeDefined();

      // 5. Balance released: pending is 0, used remains 2
      bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(0);
      expect(Number(bal?.used)).toBe(2);

      // 6. Audit LEAVE_AUTO_CANCELLED
      const autoCancelAudit = await prisma.auditLog.findFirst({
        where: {
          orgId: org.id,
          action: AuditAction.LEAVE_AUTO_CANCELLED,
          targetUserId: staff.id,
        },
      });
      expect(autoCancelAudit).toBeDefined();
      expect((autoCancelAudit?.metadata as any)?.requestIds).toContain(req2.body.id);
    });
  });
});
