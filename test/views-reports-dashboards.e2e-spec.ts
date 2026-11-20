import * as path from "path";
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { OrgStatus, Portion, Prisma, RequestStatus, Role, SkipReason } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { ClockService } from '../src/common/services/clock.service';
import { AuditAction } from '../src/audit/audit.service';
import { DateUtil } from '../src/common/utils/date.util';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Read-Only Views, Reports, Dashboards & Root Guard E2E', () => {
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

  beforeEach(async () => {
    clockService.setFixedToday('2026-11-15');
    await cleanTestDatabase(prisma);
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
        workingDays: [1, 2, 3, 4, 5],
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
      isWfh?: boolean;
      deductsBalance?: boolean;
      daysPerYear?: number;
      monthlyLimit?: number | null;
      halfDayAllowed?: boolean;
    },
  ) {
    return prisma.leaveType.create({
      data: {
        orgId,
        name: opts.name,
        paid: true,
        deductsBalance: opts.deductsBalance ?? true,
        isWfh: opts.isWfh ?? false,
        daysPerYear: opts.daysPerYear ?? 12,
        monthlyLimit: opts.monthlyLimit ?? null,
        halfDayAllowed: opts.halfDayAllowed ?? true,
        minNoticeDays: 0,
      },
    });
  }

  async function allocateBalance(
    userId: string,
    leaveTypeId: string,
    orgId: string,
    year = 2026,
    allocated = 12,
    used = 0,
    pending = 0,
  ) {
    return prisma.leaveBalance.create({
      data: {
        userId,
        leaveTypeId,
        orgId,
        year,
        allocated: new Prisma.Decimal(allocated),
        used: new Prisma.Decimal(used),
        pending: new Prisma.Decimal(pending),
      },
    });
  }

  async function createApprovedLeaveRequest(
    orgId: string,
    user: any,
    leaveType: any,
    startDateStr: string,
    endDateStr: string,
    opts?: {
      portion?: Portion;
      reason?: string;
      status?: RequestStatus;
    },
  ) {
    const portion = opts?.portion ?? Portion.full;
    const status = opts?.status ?? RequestStatus.approved;
    const start = DateUtil.parse(startDateStr);
    const end = DateUtil.parse(endDateStr);
    const spanDays = DateUtil.daysBetween(startDateStr, endDateStr);
    const weightPerDay = portion === Portion.full ? 1.0 : 0.5;
    const countedDays = spanDays * weightPerDay;

    const req = await prisma.leaveRequest.create({
      data: {
        orgId,
        userId: user.id,
        status,
        reason: opts?.reason ?? 'Approved Leave',
        spanDays,
        countedDays: new Prisma.Decimal(countedDays),
        createdBy: user.id,
        decidedBy: status === RequestStatus.approved ? user.id : null,
        decidedAt: status === RequestStatus.approved ? new Date() : null,
        decisionComment: status === RequestStatus.approved ? 'Approved' : null,
        segments: {
          create: {
            orgId,
            userId: user.id,
            leaveTypeId: leaveType.id,
            startDate: start,
            endDate: end,
            portion,
            countedDays: new Prisma.Decimal(countedDays),
          },
        },
      },
      include: {
        segments: true,
      },
    });

    const segment = req.segments[0];
    const dates = DateUtil.iterate(startDateStr, endDateStr);

    for (const d of dates) {
      await prisma.leaveSegmentDay.create({
        data: {
          segmentId: segment.id,
          requestId: req.id,
          orgId,
          userId: user.id,
          leaveTypeId: leaveType.id,
          date: DateUtil.parse(d),
          occupancy: new Prisma.Decimal(weightPerDay),
          countedWeight: new Prisma.Decimal(weightPerDay),
          skipReason: SkipReason.none,
        },
      });
    }

    return req;
  }

  // ===========================================================================
  // 1. ROOT GUARD (OrgScopeGuard)
  // ===========================================================================
  describe('Root Guard (OrgScopeGuard)', () => {
    it('restricts root user: blocks access to org routes with 403 and allows platform/auth/health', async () => {
      const org = await createOrg();
      const { token: rootToken } = await createUserAndToken(
        null,
        Role.root,
        'root@platform.local',
      );
      const { token: ownerToken } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );

      // Root can access /platform/organizations
      const platRes = await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('Authorization', `Bearer ${rootToken}`);
      expect(platRes.status).toBe(200);

      // Root can access /auth/me
      const meRes = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${rootToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.role).toBe(Role.root);

      // Root can access /health
      const healthRes = await request(app.getHttpServer())
        .get('/health')
        .set('Authorization', `Bearer ${rootToken}`);
      expect(healthRes.status).toBe(200);

      // Root is blocked from org-level routes with 403: "Root org ke andar kaam nahi karta"
      const blockedRoutes = [
        { method: 'get', path: '/approvals/pending' },
        { method: 'get', path: '/users' },
        { method: 'get', path: '/leave-requests' },
        { method: 'get', path: '/dashboard/me' },
        { method: 'get', path: '/dashboard/hr' },
        { method: 'get', path: '/reports/calendar?from=2026-11-01&to=2026-11-05' },
        { method: 'get', path: '/team/availability?from=2026-11-01&to=2026-11-05' },
        { method: 'get', path: '/my-team/availability?from=2026-11-01&to=2026-11-05' },
      ];

      for (const route of blockedRoutes) {
        const res = await (request(app.getHttpServer()) as any)
          [route.method](route.path)
          .set('Authorization', `Bearer ${rootToken}`);
        expect(res.status).toBe(403);
        expect(res.body.message).toBe('Root org ke andar kaam nahi karta');
      }

      // Non-root users accessing /platform/* are blocked with 403
      const nonRootRes = await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(nonRootRes.status).toBe(403);
    });
  });

  // ===========================================================================
  // 2. PRIVACY & ALLOWED KEYS SCAN
  // ===========================================================================
  describe('Strict Privacy & Allowed Keys Scan (/team and /my-team)', () => {
    it('deep-scans /team and /my-team responses to guarantee no leakage of reason, leaveTypeId, name, balance, or requestId', async () => {
      const org = await createOrg();
      const { user: manager, token: managerToken } = await createUserAndToken(
        org.id,
        Role.manager,
        'manager@acme.com',
      );
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
        { managerId: manager.id },
      );

      const secretReason = 'SECRET MEDICAL DIAGNOSIS';
      const secretTypeName = 'Confidential Sick Leave';
      const lt = await createLeaveType(org.id, {
        name: secretTypeName,
        isWfh: false,
      });

      await createApprovedLeaveRequest(
        org.id,
        staff,
        lt,
        '2026-11-15',
        '2026-11-16',
        { reason: secretReason },
      );

      // Check /team/availability
      const teamRes = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-15&to=2026-11-16')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(teamRes.status).toBe(200);
      expect(Object.keys(teamRes.body).sort()).toEqual(
        ['holidays', 'members'].sort(),
      );
      expect(teamRes.body.members).toHaveLength(1);
      const member = teamRes.body.members[0];

      // Exact allowed keys for member
      expect(Object.keys(member).sort()).toEqual(
        ['department', 'halfDates', 'name', 'offDates', 'segments', 'userId'].sort(),
      );

      expect(member.segments).toHaveLength(1);
      const segment = member.segments[0];
      // Exact allowed keys for segment
      expect(Object.keys(segment).sort()).toEqual(
        ['kind', 'startDate', 'endDate', 'portion'].sort(),
      );

      // Deep string check across full response body
      const stringifiedTeam = JSON.stringify(teamRes.body);
      expect(stringifiedTeam).not.toContain(secretReason);
      expect(stringifiedTeam).not.toContain(secretTypeName);
      expect(stringifiedTeam).not.toContain(lt.id);
      expect(stringifiedTeam).not.toContain('requestId');
      expect(stringifiedTeam).not.toContain('balance');

      // Check /team/availability/today
      const todayRes = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(todayRes.status).toBe(200);
      expect(Object.keys(todayRes.body).sort()).toEqual(
        ['counts', 'date', 'dayInfo', 'members'].sort(),
      );
      expect(Object.keys(todayRes.body.counts).sort()).toEqual(
        ['available', 'off', 'onLeave', 'total', 'wfh'].sort(),
      );
      expect(todayRes.body.members).toHaveLength(1);
      const todayMember = todayRes.body.members[0];
      expect(Object.keys(todayMember).sort()).toEqual(
        ['department', 'name', 'status', 'userId'].sort(),
      );

      const stringifiedToday = JSON.stringify(todayRes.body);
      expect(stringifiedToday).not.toContain(secretReason);
      expect(stringifiedToday).not.toContain(secretTypeName);
      expect(stringifiedToday).not.toContain(lt.id);

      // Check /my-team/availability
      const myTeamRes = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-11-15&to=2026-11-16')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(myTeamRes.status).toBe(200);
      const stringifiedMyTeam = JSON.stringify(myTeamRes.body);
      expect(stringifiedMyTeam).not.toContain(secretReason);
      expect(stringifiedMyTeam).not.toContain(secretTypeName);
      expect(stringifiedMyTeam).not.toContain(lt.id);
    });
  });

  // ===========================================================================
  // 3. TEAM AVAILABILITY (/team)
  // ===========================================================================
  describe('Team Availability (/team)', () => {
    it('enforces @MinRole(Role.manager), only includes direct reports, clips dates, and excludes inactive/unapproved', async () => {
      const org = await createOrg();
      const { user: manager, token: managerToken } = await createUserAndToken(
        org.id,
        Role.manager,
        'manager@acme.com',
      );
      const { user: report1 } = await createUserAndToken(
        org.id,
        Role.staff,
        'rep1@acme.com',
        { name: 'Report 1', managerId: manager.id },
      );
      const { user: report2 } = await createUserAndToken(
        org.id,
        Role.staff,
        'rep2@acme.com',
        { name: 'Report 2', managerId: manager.id },
      );
      // Deactivated direct report
      const { user: deactReport } = await createUserAndToken(
        org.id,
        Role.staff,
        'deact@acme.com',
        { name: 'Deactivated Report', managerId: manager.id },
      );
      await prisma.user.update({
        where: { id: deactReport.id },
        data: { active: false },
      });
      // Staff user with another manager
      const { user: otherStaff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'other@acme.com',
      );

      // Staff gets 403 on /team endpoints
      const staffRes = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-10&to=2026-11-20')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffRes.status).toBe(403);

      const ltLeave = await createLeaveType(org.id, {
        name: 'Sick Leave',
        isWfh: false,
      });
      const ltWfh = await createLeaveType(org.id, {
        name: 'Remote Work',
        isWfh: true,
      });

      // Report 1 has approved leave 2026-11-10 to 2026-11-18 (should be clipped to 2026-11-12..2026-11-16)
      await createApprovedLeaveRequest(
        org.id,
        report1,
        ltLeave,
        '2026-11-10',
        '2026-11-18',
        { portion: Portion.first_half },
      );

      // Report 1 also has a pending request on 2026-11-19 (must NOT show in availability)
      await createApprovedLeaveRequest(
        org.id,
        report1,
        ltWfh,
        '2026-11-19',
        '2026-11-19',
        { status: RequestStatus.pending },
      );

      // Report 2 has NO leave in range (must show up with segments: [])

      const res = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-12&to=2026-11-16')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(2); // report1 and report2, excluding deactivated and otherStaff

      const r1Data = res.body.members.find((m: any) => m.userId === report1.id);
      expect(r1Data).toBeDefined();
      expect(r1Data.segments).toHaveLength(1);
      expect(r1Data.segments[0]).toEqual({
        kind: 'leave',
        startDate: '2026-11-12', // Clipped from 2026-11-10
        endDate: '2026-11-16', // Clipped from 2026-11-18
        portion: Portion.first_half,
      });

      const r2Data = res.body.members.find((m: any) => m.userId === report2.id);
      expect(r2Data).toBeDefined();
      expect(r2Data.segments).toEqual([]);
    });

    it('returns accurate counts and member status on /team/availability/today (single counting)', async () => {
      const org = await createOrg();
      const { user: manager, token: managerToken } = await createUserAndToken(
        org.id,
        Role.manager,
        'manager@acme.com',
      );
      const { user: repLeave } = await createUserAndToken(
        org.id,
        Role.staff,
        'repleave@acme.com',
        { managerId: manager.id },
      );
      const { user: repWfh } = await createUserAndToken(
        org.id,
        Role.staff,
        'repwfh@acme.com',
        { managerId: manager.id },
      );
      const { user: repAvailable } = await createUserAndToken(
        org.id,
        Role.staff,
        'repavail@acme.com',
        { managerId: manager.id },
      );

      const ltCasual = await createLeaveType(org.id, { name: 'Casual Leave', isWfh: false });
      const ltWfh = await createLeaveType(org.id, { name: 'Work From Home', isWfh: true });

      // Fixed today is set to 2026-11-18 (Wednesday, a regular working day)
      clockService.setFixedToday('2026-11-18');

      await createApprovedLeaveRequest(org.id, repLeave, ltCasual, '2026-11-18', '2026-11-18', {
        portion: Portion.first_half,
      });
      await createApprovedLeaveRequest(org.id, repWfh, ltWfh, '2026-11-18', '2026-11-18');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-11-18');
      expect(res.body.counts).toEqual({
        onLeave: 1,
        wfh: 1,
        available: 1,
        off: 0,
        total: 3,
      });

      const leaveMember = res.body.members.find((m: any) => m.userId === repLeave.id);
      expect(leaveMember.status).toBe('leave');
      expect(leaveMember.portion).toBe(Portion.first_half);

      const wfhMember = res.body.members.find((m: any) => m.userId === repWfh.id);
      expect(wfhMember.status).toBe('wfh');

      const availMember = res.body.members.find((m: any) => m.userId === repAvailable.id);
      expect(availMember.status).toBe('available');
      expect(availMember.portion).toBeUndefined();
    });
  });

  // ===========================================================================
  // 4. MY TEAM (/my-team)
  // ===========================================================================
  describe('My Team (/my-team)', () => {
    it('allows staff to see peers and manager (including managers approved leave) but not themselves', async () => {
      const org = await createOrg();
      const { user: manager } = await createUserAndToken(
        org.id,
        Role.manager,
        'manager@acme.com',
        { name: 'Boss Manager' },
      );
      const { user: staff1, token: staff1Token } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff1@acme.com',
        { name: 'Staff 1', managerId: manager.id },
      );
      const { user: staff2 } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff2@acme.com',
        { name: 'Staff 2', managerId: manager.id },
      );

      const lt = await createLeaveType(org.id, { name: 'Vacation', isWfh: false });

      // Manager has approved leave
      await createApprovedLeaveRequest(org.id, manager, lt, '2026-11-15', '2026-11-17');

      const res = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-11-15&to=2026-11-17')
        .set('Authorization', `Bearer ${staff1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(2); // Staff 2 and Boss Manager (Staff 1 excluded)

      const memberIds = res.body.members.map((m: any) => m.userId);
      expect(memberIds).toContain(staff2.id);
      expect(memberIds).toContain(manager.id);
      expect(memberIds).not.toContain(staff1.id);

      const boss = res.body.members.find((m: any) => m.userId === manager.id);
      expect(boss.segments).toHaveLength(1);
      expect(boss.segments[0].kind).toBe('leave');
    });

    it('returns empty list for staff without a manager', async () => {
      const org = await createOrg();
      const { token: soloToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'solo@acme.com',
      );

      const res = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-11-15&to=2026-11-16')
        .set('Authorization', `Bearer ${soloToken}`);

      expect(res.status).toBe(200);
      expect(res.body.members).toEqual([]);
    });

    it('enforces 92 days maximum range limit (400 if exceeded or from > to)', async () => {
      const org = await createOrg();
      const { token } = await createUserAndToken(org.id, Role.staff, 's@acme.com');

      // from > to
      const resInvalid = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-11-20&to=2026-11-10')
        .set('Authorization', `Bearer ${token}`);
      expect(resInvalid.status).toBe(400);

      // > 92 days
      const resTooLong = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-01-01&to=2026-04-15')
        .set('Authorization', `Bearer ${token}`);
      expect(resTooLong.status).toBe(400);
      expect(resTooLong.body.message).toContain('92 days');
    });
  });

  // ===========================================================================
  // 5. HR CALENDAR & REPORTS (/reports)
  // ===========================================================================
  describe('HR Calendar & Reports (/reports)', () => {
    it('restricts /reports endpoints to @MinRole(Role.hr_admin) (staff and manager get 403)', async () => {
      const org = await createOrg();
      const { token: staffToken } = await createUserAndToken(org.id, Role.staff, 's@acme.com');
      const { token: mgrToken } = await createUserAndToken(org.id, Role.manager, 'm@acme.com');

      const staffRes = await request(app.getHttpServer())
        .get('/reports/calendar?from=2026-11-01&to=2026-11-10')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffRes.status).toBe(403);

      const mgrRes = await request(app.getHttpServer())
        .get('/reports/on-leave')
        .set('Authorization', `Bearer ${mgrToken}`);
      expect(mgrRes.status).toBe(403);
    });

    it('GET /reports/calendar returns org-wide segments with filters and includePending support', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: staff1 } = await createUserAndToken(org.id, Role.staff, 's1@acme.com', {
        department: 'Engineering',
      });
      const { user: staff2 } = await createUserAndToken(org.id, Role.staff, 's2@acme.com', {
        department: 'Marketing',
      });

      const lt = await createLeaveType(org.id, { name: 'Casual', isWfh: false });

      await createApprovedLeaveRequest(org.id, staff1, lt, '2026-11-05', '2026-11-06');
      await createApprovedLeaveRequest(org.id, staff2, lt, '2026-11-07', '2026-11-08', {
        status: RequestStatus.pending,
      });

      // 1. Without includePending: only staff1
      const resOnlyApproved = await request(app.getHttpServer())
        .get('/reports/calendar?from=2026-11-01&to=2026-11-10')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(resOnlyApproved.status).toBe(200);
      expect(resOnlyApproved.body.items).toHaveLength(1);
      expect(resOnlyApproved.body.items[0].userId).toBe(staff1.id);

      // 2. With includePending=true: both staff1 and staff2
      const resAll = await request(app.getHttpServer())
        .get('/reports/calendar?from=2026-11-01&to=2026-11-10&includePending=true')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(resAll.status).toBe(200);
      expect(resAll.body.items).toHaveLength(2);

      // 3. Department filter: Engineering
      const resDept = await request(app.getHttpServer())
        .get('/reports/calendar?from=2026-11-01&to=2026-11-10&department=Engineering&includePending=true')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(resDept.status).toBe(200);
      expect(resDept.body.items).toHaveLength(1);
      expect(resDept.body.items[0].department).toBe('Engineering');
    });

    it('GET /reports/balance-summary returns employee balances and department/type totals', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: s1 } = await createUserAndToken(org.id, Role.staff, 's1@acme.com', {
        department: 'Tech',
      });
      const { user: s2 } = await createUserAndToken(org.id, Role.staff, 's2@acme.com', {
        department: 'Sales',
      });

      const lt = await createLeaveType(org.id, { name: 'Earned Leave' });
      await allocateBalance(s1.id, lt.id, org.id, 2026, 15, 3, 2);
      await allocateBalance(s2.id, lt.id, org.id, 2026, 12, 1, 0);

      const res = await request(app.getHttpServer())
        .get('/reports/balance-summary?year=2026')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.totals.byDepartment).toHaveLength(2);
      expect(res.body.totals.byLeaveType).toHaveLength(1);

      const ltTotal = res.body.totals.byLeaveType[0];
      expect(ltTotal.allocated).toBe(27);
      expect(ltTotal.used).toBe(4);
      expect(ltTotal.pending).toBe(2);
      expect(ltTotal.available).toBe(21);
    });

    it('GET /reports/utilization returns accurate days, headcount and averages across groups', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
        { department: 'HR' },
      );
      const { user: s1 } = await createUserAndToken(org.id, Role.staff, 's1@acme.com', {
        department: 'Engineering',
      });
      const { user: s2 } = await createUserAndToken(org.id, Role.staff, 's2@acme.com', {
        department: 'Engineering',
      });

      const lt = await createLeaveType(org.id, { name: 'Casual Leave' });
      // s1 takes 2 days full leave; s2 takes 1 half day (0.5)
      await createApprovedLeaveRequest(org.id, s1, lt, '2026-11-02', '2026-11-03');
      await createApprovedLeaveRequest(org.id, s2, lt, '2026-11-04', '2026-11-04', {
        portion: Portion.first_half,
      });

      // 1. Group by department
      const resDept = await request(app.getHttpServer())
        .get('/reports/utilization?from=2026-11-01&to=2026-11-10&groupBy=department')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(resDept.status).toBe(200);

      const engDept = resDept.body.items.find((i: any) => i.department === 'Engineering');
      expect(engDept).toBeDefined();
      expect(engDept.days).toBe(2.5); // 2 + 0.5
      expect(engDept.headcount).toBe(2); // s1 and s2
      expect(engDept.perEmployeeAverage).toBe(1.25); // 2.5 / 2

      // 2. Group by leaveType
      const resType = await request(app.getHttpServer())
        .get('/reports/utilization?from=2026-11-01&to=2026-11-10&groupBy=leaveType')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(resType.status).toBe(200);
      expect(resType.body.items[0].days).toBe(2.5);

      // 3. Group by user
      const resUser = await request(app.getHttpServer())
        .get('/reports/utilization?from=2026-11-01&to=2026-11-10&groupBy=user')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(resUser.status).toBe(200);
      const s1Item = resUser.body.items.find((i: any) => i.userId === s1.id);
      const s2Item = resUser.body.items.find((i: any) => i.userId === s2.id);
      expect(s1Item.days).toBe(2);
      expect(s2Item.days).toBe(0.5);
    });

    it('supports CSV format with UTF-8 BOM, headers, and formula injection prevention', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      // User with malicious formula injection payload
      const formulaPayload = '=cmd|"/C calc"!A0';
      const { user: maliciousUser } = await createUserAndToken(
        org.id,
        Role.staff,
        'malicious@acme.com',
        { name: formulaPayload, department: '+Finance' },
      );

      const lt = await createLeaveType(org.id, { name: 'Casual' });
      await createApprovedLeaveRequest(org.id, maliciousUser, lt, '2026-11-05', '2026-11-05', {
        reason: '@dangerousFormula',
      });

      const res = await request(app.getHttpServer())
        .get('/reports/calendar?from=2026-11-01&to=2026-11-10&format=csv')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');

      // Verify UTF-8 BOM: \uFEFF
      expect(res.text.startsWith('\uFEFF')).toBe(true);

      // Formula injection prevention: characters =, +, -, @ must be prepended with '
      // and internal quotes properly escaped as ""
      expect(res.text).toContain(`"'=cmd|""/C calc""!A0"`);
      expect(res.text).toContain(`'+Finance`);
      expect(res.text).toContain(`'@dangerousFormula`);
    });
  });

  // ===========================================================================
  // 6. DASHBOARDS (/dashboard)
  // ===========================================================================
  describe('Dashboards (/dashboard)', () => {
    it('GET /dashboard/me returns balances, upcomingLeaves, pendingRequests, and holidays', async () => {
      const org = await createOrg();
      const { user: staff, token: staffToken } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );

      const ltCasual = await createLeaveType(org.id, {
        name: 'Casual Leave',
        isWfh: false,
        monthlyLimit: 4,
      });
      await allocateBalance(staff.id, ltCasual.id, org.id, 2026, 12, 2, 1);

      // Approved upcoming leave on 2026-11-20
      await createApprovedLeaveRequest(org.id, staff, ltCasual, '2026-11-20', '2026-11-21');

      // Holiday on 2026-12-25
      await prisma.holiday.create({
        data: {
          orgId: org.id,
          name: 'Christmas',
          date: new Date('2026-12-25T00:00:00.000Z'),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard/me')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.balances).toHaveLength(1);
      expect(res.body.balances[0].available).toBe(9); // 12 - 2 - 1
      expect(res.body.balances[0].monthlyLimit).toBe(4);
      expect(res.body.balances[0].usedThisMonth).toBe(2); // 2 in segment day rows for current month

      expect(res.body.upcomingLeaves).toHaveLength(1);
      expect(res.body.upcomingLeaves[0].leaveTypeName).toBe('Casual Leave');
      expect(res.body.upcomingHolidays).toHaveLength(1);
      expect(res.body.upcomingHolidays[0].name).toBe('Christmas');
    });

    it('GET /dashboard/team provides today counts and upcoming leaves for direct reports without leaking reason', async () => {
      const org = await createOrg();
      const { user: manager, token: managerToken } = await createUserAndToken(
        org.id,
        Role.manager,
        'mgr@acme.com',
      );
      const { user: report } = await createUserAndToken(
        org.id,
        Role.staff,
        'rep@acme.com',
        { managerId: manager.id },
      );

      const lt = await createLeaveType(org.id, { name: 'Secret Vacation' });
      // Upcoming leave within next 7 days (today is 2026-11-15, leave is 2026-11-18)
      await createApprovedLeaveRequest(org.id, report, lt, '2026-11-18', '2026-11-19', {
        reason: 'TOP SECRET VACATION',
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard/team')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.today).toBeDefined();
      expect(res.body.upcoming).toHaveLength(1);
      expect(res.body.upcoming[0].member.id).toBe(report.id);
      expect(res.body.upcoming[0].kind).toBe('leave');

      // Privacy: no reason or leave type name in team dashboard
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('TOP SECRET VACATION');
      expect(text).not.toContain('Secret Vacation');
    });

    it('GET /dashboard/hr filters pendingApprovalsCount by caller authority and returns org metrics', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: otherHr } = await createUserAndToken(org.id, Role.hr_admin, 'otherhr@acme.com');
      const { user: staff } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com');

      const lt = await createLeaveType(org.id, { name: 'Casual' });

      // Staff pending request (decidable by HR)
      await createApprovedLeaveRequest(org.id, staff, lt, '2026-11-20', '2026-11-21', {
        status: RequestStatus.pending,
      });

      // Other HR pending request (NOT decidable by HR Admin, only by Org Owner)
      await createApprovedLeaveRequest(org.id, otherHr, lt, '2026-11-22', '2026-11-23', {
        status: RequestStatus.pending,
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard/hr')
        .set('Authorization', `Bearer ${hrToken}`);

      expect(res.status).toBe(200);
      // HR Admin only sees 1 pending approval (Staff's request, not other HR's request)
      expect(res.body.pendingApprovalsCount).toBe(1);
      expect(res.body.headcount).toBe(3); // hr, otherHr, staff
      expect(res.body.requestsLast30Days.pending).toBe(2);
    });

    it('GET /dashboard/owner includes pendingHrAdminApprovals, activeHrAdmins, and recentAudit', async () => {
      const org = await createOrg();
      const { token: ownerToken } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );
      const { user: hrUser } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );

      const lt = await createLeaveType(org.id, { name: 'Casual' });

      // HR Admin pending request
      await createApprovedLeaveRequest(org.id, hrUser, lt, '2026-11-20', '2026-11-21', {
        status: RequestStatus.pending,
      });

      // Create an audit entry
      await prisma.auditLog.create({
        data: {
          orgId: org.id,
          actorId: hrUser.id,
          action: AuditAction.ORG_CREATED,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/dashboard/owner')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pendingHrAdminApprovals).toBe(1);
      expect(res.body.activeHrAdmins).toBe(1);
      expect(res.body.recentAudit).toHaveLength(1);
      expect(res.body.recentAudit[0].action).toBe(AuditAction.ORG_CREATED);
    });
  });

  // ===========================================================================
  // 7. TENANT ISOLATION
  // ===========================================================================
  describe('Tenant Isolation', () => {
    it('strictly isolates Org A data from Org B across availability, reports, and dashboards', async () => {
      const orgA = await createOrg('Org A');
      const orgB = await createOrg('Org B');

      const { user: staffA } = await createUserAndToken(orgA.id, Role.staff, 'staffA@a.com');
      const { user: mgrA, token: mgrAToken } = await createUserAndToken(
        orgA.id,
        Role.manager,
        'mgrA@a.com',
      );
      await prisma.user.update({
        where: { id: staffA.id },
        data: { managerId: mgrA.id },
      });

      const { token: hrBToken } = await createUserAndToken(
        orgB.id,
        Role.hr_admin,
        'hrB@b.com',
      );

      const ltA = await createLeaveType(orgA.id, { name: 'Org A Leave' });
      await createApprovedLeaveRequest(orgA.id, staffA, ltA, '2026-11-15', '2026-11-15');

      // Org B HR queries calendar: must not see Org A leave
      const resReports = await request(app.getHttpServer())
        .get('/reports/calendar?from=2026-11-01&to=2026-11-30')
        .set('Authorization', `Bearer ${hrBToken}`);

      expect(resReports.status).toBe(200);
      expect(resReports.body.items).toHaveLength(0);

      // Org B HR queries dashboard: headcount and onLeaveToday are 0 / 1 (only themselves)
      const resDash = await request(app.getHttpServer())
        .get('/dashboard/hr')
        .set('Authorization', `Bearer ${hrBToken}`);

      expect(resDash.status).toBe(200);
      expect(resDash.body.onLeaveToday.leave).toBe(0);
      expect(resDash.body.headcount).toBe(1); // Only hrB
    });
  });
});
