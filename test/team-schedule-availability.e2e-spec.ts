import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import {
  OrgStatus,
  Portion,
  Prisma,
  RequestStatus,
  Role,
  SaturdayMode,
  SkipReason,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { ClockService } from '../src/common/services/clock.service';
import { DateUtil } from '../src/common/utils/date.util';
import { cleanTestDatabase } from './test-helpers';

dotenv.config();

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Team Availability with Day Types & Schedule Resolution E2E', () => {
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
    clockService.setFixedToday('2026-11-01');
    await cleanTestDatabase(prisma);
  });

  // Helpers
  async function createOrg(name = 'Acme Corp') {
    return prisma.organization.create({
      data: {
        name,
        status: OrgStatus.active,
        financialYearStartMonth: 4,
        timezone: 'Asia/Kolkata',
        backdateAllowedDays: 7,
        workingDays: [1, 2, 3, 4, 5], // Mon-Fri
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

  async function createScheduleTemplate(
    orgId: string,
    name: string,
    saturdayMode: SaturdayMode,
    alternateOffWeeks: number[] = [],
  ) {
    return prisma.workScheduleTemplate.create({
      data: {
        orgId,
        name,
        saturdayMode,
        alternateOffWeeks,
        active: true,
      },
    });
  }

  async function assignSchedule(
    userId: string,
    templateId: string,
    effectiveFrom = '2026-01-01',
    orgId?: string,
  ) {
    let resolvedOrgId = orgId;
    if (!resolvedOrgId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      resolvedOrgId = user!.orgId!;
    }
    return prisma.employeeSchedule.create({
      data: {
        orgId: resolvedOrgId,
        userId,
        templateId,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
        createdBy: userId,
      },
    });
  }

  async function createLeaveType(
    orgId: string,
    name: string,
    isWfh = false,
  ) {
    return prisma.leaveType.create({
      data: {
        orgId,
        name,
        paid: true,
        deductsBalance: true,
        isWfh,
        daysPerYear: 12,
        halfDayAllowed: true,
        minNoticeDays: 0,
      },
    });
  }

  async function createApprovedLeave(
    orgId: string,
    user: any,
    leaveType: any,
    dateStr: string,
    opts?: { portion?: Portion; isWorkingDay?: boolean },
  ) {
    const portion = opts?.portion ?? Portion.full;
    const isWorking = opts?.isWorkingDay ?? true;
    const dateObj = DateUtil.parse(dateStr);
    const weight = portion === Portion.full ? 1.0 : 0.5;

    const req = await prisma.leaveRequest.create({
      data: {
        orgId,
        userId: user.id,
        status: RequestStatus.approved,
        reason: 'Approved Vacation',
        spanDays: 1,
        countedDays: new Prisma.Decimal(isWorking ? weight : 0),
        createdBy: user.id,
        decidedBy: user.id,
        decidedAt: new Date(),
        decisionComment: 'Approved',
        segments: {
          create: {
            orgId,
            userId: user.id,
            leaveTypeId: leaveType.id,
            startDate: dateObj,
            endDate: dateObj,
            portion,
            countedDays: new Prisma.Decimal(isWorking ? weight : 0),
          },
        },
      },
      include: { segments: true },
    });

    await prisma.leaveSegmentDay.create({
      data: {
        segmentId: req.segments[0].id,
        requestId: req.id,
        orgId,
        userId: user.id,
        leaveTypeId: leaveType.id,
        date: dateObj,
        occupancy: new Prisma.Decimal(weight),
        countedWeight: new Prisma.Decimal(isWorking ? weight : 0),
        skipReason: isWorking ? SkipReason.none : SkipReason.weekly_off,
      },
    });

    return req;
  }

  // ===========================================================================
  // 1. TODAY ENDPOINTS: SCHEDULE RESOLUTION & DAY TYPES
  // ===========================================================================
  describe('Today Endpoints with Day Types (/team/availability/today)', () => {
    let org: any;
    let managerToken: string;
    let userA: any;
    let userB: any;
    let userC: any;
    let userD: any;
    let userE: any;
    let userF: any;

    beforeEach(async () => {
      org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');
      managerToken = manager.token;

      // 6 team members reporting to manager:
      // A: 5-day (Saturday off)
      // B: Saturday half
      // C: Saturday full
      // D: alternate [1,3]
      // E: alternate [2,4]
      // F: no assignment (fallback to org.workingDays [1..5])
      const resA = await createUserAndToken(org.id, Role.staff, 'a@acme.com', { name: 'Member A', managerId: manager.user.id });
      const resB = await createUserAndToken(org.id, Role.staff, 'b@acme.com', { name: 'Member B', managerId: manager.user.id });
      const resC = await createUserAndToken(org.id, Role.staff, 'c@acme.com', { name: 'Member C', managerId: manager.user.id });
      const resD = await createUserAndToken(org.id, Role.staff, 'd@acme.com', { name: 'Member D', managerId: manager.user.id });
      const resE = await createUserAndToken(org.id, Role.staff, 'e@acme.com', { name: 'Member E', managerId: manager.user.id });
      const resF = await createUserAndToken(org.id, Role.staff, 'f@acme.com', { name: 'Member F', managerId: manager.user.id });

      userA = resA.user;
      userB = resB.user;
      userC = resC.user;
      userD = resD.user;
      userE = resE.user;
      userF = resF.user;

      const tplA = await createScheduleTemplate(org.id, 'Sat Off', SaturdayMode.off);
      const tplB = await createScheduleTemplate(org.id, 'Sat Half', SaturdayMode.half);
      const tplC = await createScheduleTemplate(org.id, 'Sat Full', SaturdayMode.full);
      const tplD = await createScheduleTemplate(org.id, 'Alt 1,3', SaturdayMode.alternate, [1, 3]);
      const tplE = await createScheduleTemplate(org.id, 'Alt 2,4', SaturdayMode.alternate, [2, 4]);

      await assignSchedule(userA.id, tplA.id);
      await assignSchedule(userB.id, tplB.id);
      await assignSchedule(userC.id, tplC.id);
      await assignSchedule(userD.id, tplD.id);
      await assignSchedule(userE.id, tplE.id);
      // Member F has no assignment
    });

    it('7 Nov (1st Saturday): A off, B available halfDay, C available, D off, E available, F off', async () => {
      clockService.setFixedToday('2026-11-07');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-11-07');
      expect(res.body.dayInfo.isHoliday).toBe(false);

      const members = res.body.members;
      const mA = members.find((m: any) => m.userId === userA.id);
      const mB = members.find((m: any) => m.userId === userB.id);
      const mC = members.find((m: any) => m.userId === userC.id);
      const mD = members.find((m: any) => m.userId === userD.id);
      const mE = members.find((m: any) => m.userId === userE.id);
      const mF = members.find((m: any) => m.userId === userF.id);

      expect(mA.status).toBe('off');
      expect(mB.status).toBe('available');
      expect(mB.halfDay).toBe(true);
      expect(mC.status).toBe('available');
      expect(mC.halfDay).toBeUndefined();
      expect(mD.status).toBe('off');
      expect(mE.status).toBe('available');
      expect(mE.halfDay).toBeUndefined();
      expect(mF.status).toBe('off');

      expect(res.body.counts).toEqual({
        onLeave: 0,
        wfh: 0,
        available: 3, // B, C, E
        off: 3, // A, D, F
        total: 6,
      });
      expect(res.body.counts.onLeave + res.body.counts.wfh + res.body.counts.available + res.body.counts.off).toBe(res.body.counts.total);
    });

    it('14 Nov (2nd Saturday): D available, E off', async () => {
      clockService.setFixedToday('2026-11-14');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      const members = res.body.members;
      const mD = members.find((m: any) => m.userId === userD.id);
      const mE = members.find((m: any) => m.userId === userE.id);

      expect(mD.status).toBe('available');
      expect(mE.status).toBe('off');
    });

    it('21 Nov (3rd Saturday): D off, E available', async () => {
      clockService.setFixedToday('2026-11-21');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      const members = res.body.members;
      const mD = members.find((m: any) => m.userId === userD.id);
      const mE = members.find((m: any) => m.userId === userE.id);

      expect(mD.status).toBe('off');
      expect(mE.status).toBe('available');
    });

    it('28 Nov (4th Saturday): D available, E off', async () => {
      clockService.setFixedToday('2026-11-28');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      const members = res.body.members;
      const mD = members.find((m: any) => m.userId === userD.id);
      const mE = members.find((m: any) => m.userId === userE.id);

      expect(mD.status).toBe('available');
      expect(mE.status).toBe('off');
    });

    it('Sunday (8 Nov): all members are off regardless of template', async () => {
      clockService.setFixedToday('2026-11-08');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-11-08');
      expect(res.body.members.every((m: any) => m.status === 'off')).toBe(true);
      expect(res.body.counts).toEqual({
        onLeave: 0,
        wfh: 0,
        available: 0,
        off: 6,
        total: 6,
      });
    });

    it('Holiday on a weekday (Wednesday 11 Nov): dayInfo.isHoliday true, holidayName, all off, counts.off = total', async () => {
      await prisma.holiday.create({
        data: {
          orgId: org.id,
          name: 'Diwali',
          date: new Date('2026-11-11T00:00:00.000Z'),
          active: true,
        },
      });

      clockService.setFixedToday('2026-11-11');

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-11-11');
      expect(res.body.dayInfo).toEqual({
        isHoliday: true,
        holidayName: 'Diwali',
      });
      expect(res.body.members.every((m: any) => m.status === 'off')).toBe(true);
      expect(res.body.counts).toEqual({
        onLeave: 0,
        wfh: 0,
        available: 0,
        off: 6,
        total: 6,
      });
    });

    it('Approved leave on Saturday off shows member as "off" (not counted in leave); working Saturday shows "leave" or "wfh"', async () => {
      clockService.setFixedToday('2026-11-07'); // 1st Saturday

      const ltCasual = await createLeaveType(org.id, 'Casual Leave', false);
      const ltWfh = await createLeaveType(org.id, 'Remote', true);

      // 1. Member A has an approved leave record on 7 Nov, but 7 Nov is A's weeklyOff (Saturday off)
      await createApprovedLeave(org.id, userA, ltCasual, '2026-11-07', { isWorkingDay: false });

      // 2. Member C has an approved leave on 7 Nov, and 7 Nov is C's working day (Saturday full)
      await createApprovedLeave(org.id, userC, ltCasual, '2026-11-07', { isWorkingDay: true });

      // 3. Member E has an approved WFH on 7 Nov, and 7 Nov is E's working day (1st Sat working under [2,4] alternate off)
      await createApprovedLeave(org.id, userE, ltWfh, '2026-11-07', { isWorkingDay: true });

      const res = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);

      const mA = res.body.members.find((m: any) => m.userId === userA.id);
      const mC = res.body.members.find((m: any) => m.userId === userC.id);
      const mE = res.body.members.find((m: any) => m.userId === userE.id);

      // A is OFF, not leave (since it is a weeklyOff date)
      expect(mA.status).toBe('off');

      // C is LEAVE (working day leave)
      expect(mC.status).toBe('leave');
      expect(mC.portion).toBe(Portion.full);

      // E is WFH (working day WFH)
      expect(mE.status).toBe('wfh');
      expect(mE.portion).toBe(Portion.full);

      expect(res.body.counts).toEqual({
        onLeave: 1, // Member C
        wfh: 1, // Member E
        available: 1, // Member B (halfDay)
        off: 3, // Member A (weeklyOff despite leave), Member D, Member F
        total: 6,
      });
      expect(res.body.counts.onLeave + res.body.counts.wfh + res.body.counts.available + res.body.counts.off).toBe(res.body.counts.total);
    });
  });

  // ===========================================================================
  // 2. RANGE ENDPOINT (/team/availability & /my-team/availability)
  // ===========================================================================
  describe('Range Endpoints with offDates, halfDates, and Holidays (/team/availability)', () => {
    it('returns holidays list at top level and accurate offDates/halfDates for members over a 14-day range', async () => {
      const org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');

      const resA = await createUserAndToken(org.id, Role.staff, 'a@acme.com', { name: 'Member A', managerId: manager.user.id });
      const resB = await createUserAndToken(org.id, Role.staff, 'b@acme.com', { name: 'Member B', managerId: manager.user.id });
      const resD = await createUserAndToken(org.id, Role.staff, 'd@acme.com', { name: 'Member D', managerId: manager.user.id });

      const tplA = await createScheduleTemplate(org.id, 'Sat Off', SaturdayMode.off);
      const tplB = await createScheduleTemplate(org.id, 'Sat Half', SaturdayMode.half);
      const tplD = await createScheduleTemplate(org.id, 'Alt 1,3', SaturdayMode.alternate, [1, 3]);

      await assignSchedule(resA.user.id, tplA.id);
      await assignSchedule(resB.user.id, tplB.id);
      await assignSchedule(resD.user.id, tplD.id);

      // Active Holiday on Wednesday 2026-11-11
      await prisma.holiday.create({
        data: {
          orgId: org.id,
          name: 'Diwali',
          date: new Date('2026-11-11T00:00:00.000Z'),
          active: true,
        },
      });

      // Range: 2026-11-01 (Sun) to 2026-11-14 (Sat) - 14 days
      const res = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-01&to=2026-11-14')
        .set('Authorization', `Bearer ${manager.token}`);

      expect(res.status).toBe(200);

      // 1. Top-level holidays list
      expect(res.body.holidays).toHaveLength(1);
      expect(res.body.holidays[0]).toEqual({
        date: '2026-11-11',
        name: 'Diwali',
      });

      // 2. Member A (Saturday off):
      // offDates: Sundays (1, 8), Saturdays (7, 14), and Diwali (11)
      const mA = res.body.members.find((m: any) => m.userId === resA.user.id);
      expect(mA.offDates).toEqual([
        '2026-11-01',
        '2026-11-07',
        '2026-11-08',
        '2026-11-11',
        '2026-11-14',
      ]);
      expect(mA.halfDates).toEqual([]);

      // 3. Member B (Saturday half):
      // offDates: Sundays (1, 8), Diwali (11). Saturdays (7, 14) are halfDates
      const mB = res.body.members.find((m: any) => m.userId === resB.user.id);
      expect(mB.offDates).toEqual([
        '2026-11-01',
        '2026-11-08',
        '2026-11-11',
      ]);
      expect(mB.halfDates).toEqual([
        '2026-11-07',
        '2026-11-14',
      ]);

      // 4. Member D (alternate [1, 3] off):
      // 1st Sat (7) is off; 2nd Sat (14) is working full day.
      // offDates: Sundays (1, 8), 1st Sat (7), Diwali (11).
      const mD = res.body.members.find((m: any) => m.userId === resD.user.id);
      expect(mD.offDates).toEqual([
        '2026-11-01',
        '2026-11-07',
        '2026-11-08',
        '2026-11-11',
      ]);
      expect(mD.halfDates).toEqual([]);
    });

    it('rejects date range exceeding 92 days with 400', async () => {
      const org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');

      const res = await request(app.getHttpServer())
        .get('/team/availability?from=2026-01-01&to=2026-04-15')
        .set('Authorization', `Bearer ${manager.token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('92 days');
    });
  });

  // ===========================================================================
  // 3. STRICT PRIVACY DEEP SCAN
  // ===========================================================================
  describe('Strict Privacy Deep Scan', () => {
    it('deep-scans both range and today responses to ensure zero leak of schedule template names, rules, reasons, or balances', async () => {
      const org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');
      const staff = await createUserAndToken(org.id, Role.staff, 's@acme.com', { managerId: manager.user.id });

      const secretTemplateName = 'SUPER_SECRET_COMPLEX_ROSTER_RULE_2026';
      const tpl = await createScheduleTemplate(org.id, secretTemplateName, SaturdayMode.alternate, [1, 3]);
      await assignSchedule(staff.user.id, tpl.id);

      const secretReason = 'CONFIDENTIAL_PERSONAL_DIAGNOSIS';
      const secretTypeName = 'Classified Medical Leave';
      const lt = await createLeaveType(org.id, secretTypeName, false);
      await createApprovedLeave(org.id, staff.user, lt, '2026-11-05');

      // 1. Range endpoint check
      const rangeRes = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-01&to=2026-11-10')
        .set('Authorization', `Bearer ${manager.token}`);

      expect(rangeRes.status).toBe(200);
      const rangeText = JSON.stringify(rangeRes.body);
      expect(rangeText).not.toContain(secretTemplateName);
      expect(rangeText).not.toContain('saturdayMode');
      expect(rangeText).not.toContain('alternateOffWeeks');
      expect(rangeText).not.toContain(secretReason);
      expect(rangeText).not.toContain(secretTypeName);
      expect(rangeText).not.toContain(lt.id);
      expect(rangeText).not.toContain('balance');

      // 2. Today endpoint check
      const todayRes = await request(app.getHttpServer())
        .get('/team/availability/today')
        .set('Authorization', `Bearer ${manager.token}`);

      expect(todayRes.status).toBe(200);
      const todayText = JSON.stringify(todayRes.body);
      expect(todayText).not.toContain(secretTemplateName);
      expect(todayText).not.toContain('saturdayMode');
      expect(todayText).not.toContain('alternateOffWeeks');
      expect(todayText).not.toContain(secretReason);
      expect(todayText).not.toContain(secretTypeName);
    });
  });

  // ===========================================================================
  // 4. BATCH RESOLUTION EFFICIENCY (NO N+1 QUERIES)
  // ===========================================================================
  describe('Batch Schedule Resolution Efficiency (No N+1 Queries)', () => {
    it('executes exactly 1 employeeSchedule query for 50 members in a team availability request', async () => {
      const org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');

      // Create 50 active direct reports
      const userCreatePromises: any[] = [];
      const userIds: string[] = [];
      for (let i = 1; i <= 50; i++) {
        userCreatePromises.push(
          createUserAndToken(org.id, Role.staff, `staff${i}@acme.com`, {
            name: `Staff ${i}`,
            managerId: manager.user.id,
          }),
        );
      }
      const createdUsers = await Promise.all(userCreatePromises);
      for (const u of createdUsers) {
        userIds.push(u.user.id);
      }

      // Assign templates to some
      const tpl = await createScheduleTemplate(org.id, 'Standard 5-day', SaturdayMode.off);
      await prisma.employeeSchedule.createMany({
        data: userIds.slice(0, 25).map((uId) => ({
          orgId: org.id,
          userId: uId,
          templateId: tpl.id,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          createdBy: manager.user.id,
        })),
      });

      // Spy on prisma.employeeSchedule.findMany
      const spyFindMany = jest.spyOn(prisma.employeeSchedule, 'findMany');

      const res = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-01&to=2026-11-14')
        .set('Authorization', `Bearer ${manager.token}`);

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(50);

      // Verify that findMany was called EXACTLY once for all 50 members (no N+1 loop)
      expect(spyFindMany).toHaveBeenCalledTimes(1);

      spyFindMany.mockRestore();
    });
  });

  // ===========================================================================
  // 5. MY-TEAM & DASHBOARD/TEAM CONSISTENCY
  // ===========================================================================
  describe('My-Team and Dashboard/Team Consistency', () => {
    it('GET /my-team/availability resolves peers and manager with identical offDates and halfDates', async () => {
      const org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com', { name: 'Manager Bob' });
      const staff1 = await createUserAndToken(org.id, Role.staff, 's1@acme.com', { name: 'Staff 1', managerId: manager.user.id });
      const staff2 = await createUserAndToken(org.id, Role.staff, 's2@acme.com', { name: 'Staff 2', managerId: manager.user.id });

      const tplHalf = await createScheduleTemplate(org.id, 'Sat Half', SaturdayMode.half);
      await assignSchedule(manager.user.id, tplHalf.id);

      const res = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-11-07&to=2026-11-07')
        .set('Authorization', `Bearer ${staff1.token}`);

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(2); // staff2 and manager

      const mgrInTeam = res.body.members.find((m: any) => m.userId === manager.user.id);
      expect(mgrInTeam.halfDates).toContain('2026-11-07');
    });

    it('GET /dashboard/team includes "off" in today counts and excludes off-date leaves from upcoming', async () => {
      const org = await createOrg();
      const manager = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');
      const staff = await createUserAndToken(org.id, Role.staff, 's@acme.com', { managerId: manager.user.id });

      const tplOff = await createScheduleTemplate(org.id, 'Sat Off', SaturdayMode.off);
      await assignSchedule(staff.user.id, tplOff.id);

      const lt = await createLeaveType(org.id, 'Vacation');
      // Approved leave on Saturday 7 Nov (an off date)
      await createApprovedLeave(org.id, staff.user, lt, '2026-11-07', { isWorkingDay: false });

      clockService.setFixedToday('2026-11-07');

      const res = await request(app.getHttpServer())
        .get('/dashboard/team')
        .set('Authorization', `Bearer ${manager.token}`);

      expect(res.status).toBe(200);
      // today counts includes "off"
      expect(res.body.today.off).toBe(1);
      expect(res.body.today.onLeave).toBe(0);
      expect(res.body.today.available).toBe(0);
      expect(res.body.today.total).toBe(1);

      // Upcoming leave falling strictly on an off date is NOT considered upcoming leave
      expect(res.body.upcoming).toEqual([]);
    });
  });
});
