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
import { DateUtil } from '../src/common/utils/date.util';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Leave Requests Module E2E', () => {
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

  // Helpers
  async function createOrg(
    name = 'Acme Corp',
    extra?: Partial<Prisma.OrganizationCreateInput>,
  ) {
    return prisma.organization.create({
      data: {
        name,
        status: OrgStatus.active,
        financialYearStartMonth: 4, // April - March
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
    password = 'Password123!',
  ): Promise<{ user: any; token: string }> {
    const hash = await passwordService.hash(password);
    const user = await prisma.user.create({
      data: {
        orgId,
        email: email.toLowerCase().trim(),
        name: `${role} User`,
        passwordHash: hash,
        role,
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
  // 1. SUBMIT LEAVE REQUEST (POST /leave-requests) & BREAKDOWN
  // ===========================================================================
  describe('POST /leave-requests - Submission & Breakdown', () => {
    it('submits a single-segment request over working days and reserves balance', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'staff@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // Mon 2026-11-02 to Wed 2026-11-04 (3 working days)
      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Family visit',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe(RequestStatus.pending);
      expect(Number(res.body.spanDays)).toBe(3);
      expect(Number(res.body.countedDays)).toBe(3);
      expect(res.body.segments).toHaveLength(1);
      expect(res.body.segmentDays).toHaveLength(3);

      // Verify balance pending updated
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(3);
      expect(Number(bal?.allocated)).toBe(10);
      expect(Number(bal?.used)).toBe(0);
    });

    it('submits a multi-segment request in 1 call (Casual, WFH, Casual)', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'multiseg@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      const wfh = await createLeaveType(org.id, {
        name: 'Work From Home',
        deductsBalance: false,
        isWfh: true,
      });

      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // Wed 11 Nov (CL), Thu 12 - Fri 13 Nov (WFH), Mon 16 Nov (CL)
      // Sat 14 and Sun 15 are skipped automatically as weekly off
      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Hybrid trip',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-11',
              endDate: '2026-11-11',
              portion: Portion.full,
            },
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-12',
              endDate: '2026-11-13',
              portion: Portion.full,
            },
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-16',
              endDate: '2026-11-16',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.segments).toHaveLength(3);
      // Span is from 2026-11-11 to 2026-11-16 inclusive = 6 days
      expect(Number(res.body.spanDays)).toBe(6);
      // Counted days: 1 (CL) + 2 (WFH) + 1 (CL) = 4
      expect(Number(res.body.countedDays)).toBe(4);

      // Balances: only CL deducts balance (2 days reserved), WFH does not deduct
      const clBal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(clBal?.pending)).toBe(2);
    });
  });

  // ===========================================================================
  // 2. OVERLAP VALIDATIONS (OVERLAP)
  // ===========================================================================
  describe('Overlap Validations', () => {
    it('detects external overlap with nextFreeDate and allows adjacent requests', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'overlap@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 20, 0, 0);

      // 1. Submit 2026-11-02 (Mon) to 2026-11-06 (Fri)
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Week 1',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-06',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(201);

      // 2. Overlapping request: 2026-11-05 to 2026-11-10 -> 409 OVERLAP
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Overlap attempt',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-05',
              endDate: '2026-11-10',
              portion: Portion.full,
            },
          ],
        });

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe('OVERLAP');
      expect(res2.body.details).toBeDefined();
      expect(res2.body.details.conflicts).toHaveLength(1);
      expect(res2.body.details.conflicts[0].overlappingDates).toHaveLength(2); // 05 and 06
      expect(res2.body.details.nextFreeDate).toBe('2026-11-07');

      // 3. Adjacent request starting 2026-11-09 (Mon) to 2026-11-13 (Fri) -> succeeds
      const res3 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Week 2 adjacent',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-09',
              endDate: '2026-11-13',
              portion: Portion.full,
            },
          ],
        });
      expect(res3.status).toBe(201);
    });

    it('validates same-request internal overlap: full+full rejected, first+second half allowed', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'internal@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      const wfh = await createLeaveType(org.id, {
        name: 'Work From Home',
        deductsBalance: false,
        isWfh: true,
      });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // A. Full + Full overlap within same request -> 409 OVERLAP
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Two full segments overlapping',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-03',
              endDate: '2026-11-05',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(409);
      expect(res1.body.code).toBe('OVERLAP');

      // B. first_half + second_half on same day in same request -> ALLOWED
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Split day: half CL, half WFH',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.first_half,
            },
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.second_half,
            },
          ],
        });
      expect(res2.status).toBe(201);
      expect(Number(res2.body.countedDays)).toBe(1);

      // C. first_half + first_half on same day in same request -> rejected
      const res3 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Double first half',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.first_half,
            },
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.first_half,
            },
          ],
        });
      expect(res3.status).toBe(409);
      expect(res3.body.code).toBe('OVERLAP');

      // D. Full + first_half on same day in same request -> rejected
      const res4 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Full plus half',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-04',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-04',
              endDate: '2026-11-04',
              portion: Portion.first_half,
            },
          ],
        });
      expect(res4.status).toBe(409);
      expect(res4.body.code).toBe('OVERLAP');
    });

    it('cancelled and rejected requests do not block dates', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'free_dates@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // 1. Submit request
      const createRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'To be cancelled',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(createRes.status).toBe(201);
      const reqId = createRes.body.id;

      // 2. Cancel the request
      const cancelRes = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel`)
        .set('Authorization', `Bearer ${token}`);
      expect(cancelRes.status).toBe(200);

      // 3. Re-apply on the exact same dates -> succeeds!
      const reapplyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Re-applying on same dates',
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

    it('allows two DIFFERENT users to apply on the exact same dates: both receive 201 Created (overlap is strictly scoped per user)', async () => {
      const org = await createOrg();
      const { user: userA, token: tokenA } = await createUserAndToken(
        org.id,
        Role.staff,
        'user_a_overlap@acme.com',
      );
      const { user: userB, token: tokenB } = await createUserAndToken(
        org.id,
        Role.staff,
        'user_b_overlap@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(userA.id, cl.id, 2026, 10, 0, 0);
      await setLeaveBalance(userB.id, cl.id, 2026, 10, 0, 0);

      const targetDates = {
        startDate: '2026-11-18',
        endDate: '2026-11-20',
      };

      // User A applies for 2026-11-18 to 2026-11-20 -> 201 Created
      const resA = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'User A vacation',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: targetDates.startDate,
              endDate: targetDates.endDate,
              portion: Portion.full,
            },
          ],
        });
      expect(resA.status).toBe(201);

      // User B applies on the EXACT SAME dates -> 201 Created (no overlap between distinct users)
      const resB = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          reason: 'User B vacation on same dates',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: targetDates.startDate,
              endDate: targetDates.endDate,
              portion: Portion.full,
            },
          ],
        });
      expect(resB.status).toBe(201);
    });

    it('rejects the SAME user applying twice on the exact same dates with 409 OVERLAP', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'same_user_overlap@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const targetDates = {
        startDate: '2026-11-23',
        endDate: '2026-11-25',
      };

      // First submission -> 201 Created
      const firstRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'First application',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: targetDates.startDate,
              endDate: targetDates.endDate,
              portion: Portion.full,
            },
          ],
        });
      expect(firstRes.status).toBe(201);

      // Second submission by same user on exact same dates -> 409 OVERLAP
      const secondRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Duplicate application attempt',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: targetDates.startDate,
              endDate: targetDates.endDate,
              portion: Portion.full,
            },
          ],
        });
      expect(secondRes.status).toBe(409);
      expect(secondRes.body.code).toBe('OVERLAP');
      expect(secondRes.body.details).toBeDefined();
      expect(secondRes.body.details.conflicts).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 3. VALIDATIONS & ERROR CODES
  // ===========================================================================
  describe('Validations & Error Codes', () => {
    it('returns ZERO_COUNTED_DAYS when applying strictly on weekend', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'weekend@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // 2026-11-15 is Sunday
      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Sunday only leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-15',
              endDate: '2026-11-15',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ZERO_COUNTED_DAYS');
    });

    it('returns HALF_DAY_NOT_ALLOWED when half-day is disabled or requested on multi-day range', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'halfday@acme.com',
      );
      const clNoHalf = await createLeaveType(org.id, {
        name: 'No Half Day Leave',
        halfDayAllowed: false,
      });
      const clHalf = await createLeaveType(org.id, {
        name: 'Half Day Allowed Leave',
        halfDayAllowed: true,
      });
      await setLeaveBalance(staff.id, clNoHalf.id, 2026, 10, 0, 0);
      await setLeaveBalance(staff.id, clHalf.id, 2026, 10, 0, 0);

      // A. Leave type does not allow half day
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Trying half day',
          segments: [
            {
              leaveTypeId: clNoHalf.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.first_half,
            },
          ],
        });
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe('HALF_DAY_NOT_ALLOWED');

      // B. Multi-day range with portion != full
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Multi-day half day',
          segments: [
            {
              leaveTypeId: clHalf.id,
              startDate: '2026-11-02',
              endDate: '2026-11-03',
              portion: Portion.first_half,
            },
          ],
        });
      expect(res2.status).toBe(400);
      expect(res2.body.code).toBe('HALF_DAY_NOT_ALLOWED');
    });

    it('validates backdateAllowedDays: backdate within limit passes, beyond limit fails', async () => {
      const org = await createOrg('Acme Backdate', { backdateAllowedDays: 5 });
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'backdate@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      // Clock is set to 2026-11-10
      clockService.setFixedToday('2026-11-10');

      // 1. Leave from 2026-11-06 (4 days back <= 5) -> succeeds
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Recent past illness',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-06',
              endDate: '2026-11-06',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(201);

      // 2. Leave from 2026-11-03 (7 days back > 5) -> fails BACKDATE_NOT_ALLOWED
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Old illness',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
          ],
        });
      expect(res2.status).toBe(400);
      expect(res2.body.code).toBe('BACKDATE_NOT_ALLOWED');
    });

    it('validates minNoticeDays: requesting without sufficient notice fails MIN_NOTICE', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'notice@acme.com',
      );
      const el = await createLeaveType(org.id, {
        name: 'Earned Leave',
        minNoticeDays: 3,
      });
      await setLeaveBalance(staff.id, el.id, 2026, 10, 0, 0);

      // Today is 2026-11-01. Notice required: 3 days.
      // Request for 2026-11-02 has 1 day notice -> fails
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Urgent planned leave',
          segments: [
            {
              leaveTypeId: el.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(400);
      expect(res1.body.code).toBe('MIN_NOTICE');

      // Request for 2026-11-05 has 4 days notice -> succeeds
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Well planned leave',
          segments: [
            {
              leaveTypeId: el.id,
              startDate: '2026-11-05',
              endDate: '2026-11-05',
              portion: Portion.full,
            },
          ],
        });
      expect(res2.status).toBe(201);
    });

    it('returns INVALID_SEGMENT when startDate is after endDate', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'badseg@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });

      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Reversed dates',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-05',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_SEGMENT');
    });
  });

  // ===========================================================================
  // 4. BALANCES & FINANCIAL YEAR SPLIT
  // ===========================================================================
  describe('Balances & Financial Year Split', () => {
    it('returns NO_BALANCE if no balance record exists for user in the leave year', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'nobal@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      // Note: No balance allocated!

      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'No balance',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NO_BALANCE');
    });

    it('returns INSUFFICIENT_BALANCE and atomically rolls back without creating records or updating pending', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'insufficient@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      // Only 2 days allocated
      await setLeaveBalance(staff.id, cl.id, 2026, 2, 0, 0);

      // Request 3 days (Mon 2 Nov to Wed 4 Nov)
      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Need 3 days',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INSUFFICIENT_BALANCE');

      // Verify DB rollback
      const reqCount = await prisma.leaveRequest.count({
        where: { userId: staff.id },
      });
      expect(reqCount).toBe(0);

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
      expect(Number(bal?.allocated)).toBe(2);
    });

    it('handles cross-leave-year request spanning 31 March and 1 April (FY start: April)', async () => {
      const org = await createOrg('Acme FY Split', { financialYearStartMonth: 4 });
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'yearsplit@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });

      // In April FY: 2027-03-31 is leave year 2026; 2027-04-01 is leave year 2027
      await setLeaveBalance(staff.id, cl.id, 2026, 5, 0, 0);
      await setLeaveBalance(staff.id, cl.id, 2027, 5, 0, 0);

      clockService.setFixedToday('2027-03-25');

      // 2027-03-31 (Wed) to 2027-04-01 (Thu)
      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'FY transition leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2027-03-31',
              endDate: '2027-04-01',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.countedDays)).toBe(2);

      // Verify pending split: 1 day in 2026, 1 day in 2027
      const bal2026 = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      const bal2027 = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2027,
          },
        },
      });

      expect(Number(bal2026?.pending)).toBe(1);
      expect(Number(bal2027?.pending)).toBe(1);
    });
  });

  // ===========================================================================
  // 5. WFH & MONTHLY LIMITS
  // ===========================================================================
  describe('WFH & Monthly Limits', () => {
    it('enforces monthlyLimit on WFH, and cancelled request frees up limit', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'wfhlimit@acme.com',
      );
      const wfh = await createLeaveType(org.id, {
        name: 'Work From Home',
        deductsBalance: false,
        isWfh: true,
        monthlyLimit: 2,
      });

      // 1. Submit Day 1: 2026-11-02 (Mon) -> succeeds
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'WFH Day 1',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(201);

      // 2. Submit Day 2: 2026-11-03 (Tue) -> succeeds (total 2 days in Nov)
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'WFH Day 2',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
          ],
        });
      expect(res2.status).toBe(201);
      const req2Id = res2.body.id;

      // 3. Submit Day 3 in Nov: 2026-11-04 (Wed) -> fails MONTHLY_LIMIT_EXCEEDED
      const res3 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'WFH Day 3',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-04',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(res3.status).toBe(400);
      expect(res3.body.code).toBe('MONTHLY_LIMIT_EXCEEDED');

      // 4. Cancel Request 2
      const cancelRes = await request(app.getHttpServer())
        .post(`/leave-requests/${req2Id}/cancel`)
        .set('Authorization', `Bearer ${token}`);
      expect(cancelRes.status).toBe(200);

      // 5. Now submitting Day 3 succeeds because cancelled days do not count!
      const res4 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'WFH Day 3 re-attempt',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-04',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(res4.status).toBe(201);
    });

    it('validates monthlyLimit across distinct calendar months independently', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'crossmonth@acme.com',
      );
      const wfh = await createLeaveType(org.id, {
        name: 'Work From Home',
        deductsBalance: false,
        isWfh: true,
        monthlyLimit: 2,
      });

      // Request 2 days in Nov (30 Nov) and 2 days in Dec (1 Dec, 2 Dec)
      // 2026-11-30 is Mon; 2026-12-01 is Tue, 2026-12-02 is Wed.
      // 1 day in Nov <= 2; 2 days in Dec <= 2.
      const res = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Cross month WFH',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-30',
              endDate: '2026-11-30',
              portion: Portion.full,
            },
            {
              leaveTypeId: wfh.id,
              startDate: '2026-12-01',
              endDate: '2026-12-02',
              portion: Portion.full,
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.countedDays)).toBe(3);
    });
  });

  // ===========================================================================
  // 6. CONCURRENCY & ADVISORY LOCK
  // ===========================================================================
  describe('Concurrency & Advisory Lock', () => {
    it('handles 5 concurrent submissions on same dates by same user: exactly 1 succeeds, 4 fail OVERLAP', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'concurrent_same@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 20, 0, 0);

      const payload = {
        reason: 'Concurrent same date attempt',
        segments: [
          {
            leaveTypeId: cl.id,
            startDate: '2026-11-02',
            endDate: '2026-11-04',
            portion: Portion.full,
          },
        ],
      };

      const promises = Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post('/leave-requests')
          .set('Authorization', `Bearer ${token}`)
          .send(payload),
      );

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(4);
      failures.forEach((f) => expect(f.body.code).toBe('OVERLAP'));

      // Check DB: exactly 1 request created
      const dbCount = await prisma.leaveRequest.count({
        where: { userId: staff.id },
      });
      expect(dbCount).toBe(1);

      // Check pending balance: exactly 3 days reserved
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(3);
    });

    it('handles 5 concurrent submissions on different dates with 3 days balance: exactly 3 succeed, 2 fail', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'concurrent_diff@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      // Only 3 days balance
      await setLeaveBalance(staff.id, cl.id, 2026, 3, 0, 0);

      // 5 different single-day requests on working days
      const dates = [
        '2026-11-02', // Mon
        '2026-11-03', // Tue
        '2026-11-04', // Wed
        '2026-11-05', // Thu
        '2026-11-06', // Fri
      ];

      const promises = dates.map((date) =>
        request(app.getHttpServer())
          .post('/leave-requests')
          .set('Authorization', `Bearer ${token}`)
          .send({
            reason: `Day ${date}`,
            segments: [
              {
                leaveTypeId: cl.id,
                startDate: date,
                endDate: date,
                portion: Portion.full,
              },
            ],
          }),
      );

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 400);

      expect(successes).toHaveLength(3);
      expect(failures).toHaveLength(2);
      failures.forEach((f) => expect(f.body.code).toBe('INSUFFICIENT_BALANCE'));

      // Check DB: exactly 3 requests created
      const dbCount = await prisma.leaveRequest.count({
        where: { userId: staff.id },
      });
      expect(dbCount).toBe(3);

      // Final pending balance is exactly 3
      const bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId: staff.id,
            leaveTypeId: cl.id,
            year: 2026,
          },
        },
      });
      expect(Number(bal?.pending)).toBe(3);
    });
  });

  // ===========================================================================
  // 7. CANCELLATION (POST /leave-requests/:id/cancel)
  // ===========================================================================
  describe('Cancellation', () => {
    it('cancels personal pending request and releases reserved balance', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'cancel_ok@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const createRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Need time off',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(createRes.status).toBe(201);
      const reqId = createRes.body.id;

      // Pending balance before cancel
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

      // Cancel
      const cancelRes = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe(RequestStatus.cancelled);

      // Pending balance after cancel is 0
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
    });

    it('returns 409 if trying to cancel non-pending request (already cancelled or approved)', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'cancel_fail@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const createRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Need time off',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = createRes.body.id;

      // First cancel succeeds
      await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel`)
        .set('Authorization', `Bearer ${token}`);

      // Second cancel returns 409
      const secondCancel = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel`)
        .set('Authorization', `Bearer ${token}`);

      expect(secondCancel.status).toBe(409);
      expect(secondCancel.body.code).toBe('CANNOT_CANCEL_REQUEST');
    });

    it('returns 404 if user tries to cancel another user request', async () => {
      const org = await createOrg();
      const { user: staff1, token: token1 } = await createUserAndToken(
        org.id,
        Role.staff,
        'user1@acme.com',
      );
      const { user: staff2, token: token2 } = await createUserAndToken(
        org.id,
        Role.staff,
        'user2@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff1.id, cl.id, 2026, 10, 0, 0);

      const createRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          reason: 'User 1 leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = createRes.body.id;

      // User 2 attempts to cancel User 1's request
      const cancelRes = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel`)
        .set('Authorization', `Bearer ${token2}`);

      expect(cancelRes.status).toBe(404);
    });
  });

  // ===========================================================================
  // 8. ROLES & AUTHORIZATION
  // ===========================================================================
  describe('Roles & Permissions', () => {
    it('forbids org_owner and root from applying for leave with 403', async () => {
      const org = await createOrg();
      const { token: ownerToken } = await createUserAndToken(
        org.id,
        Role.org_owner,
        'owner@acme.com',
      );
      const { token: rootToken } = await createUserAndToken(
        null,
        Role.root,
        'root@platform.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });

      // Org owner
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          reason: 'Owner leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(403);
      expect(res1.body.message).toContain('Owner leave apply nahi karta');

      // Root
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${rootToken}`)
        .send({
          reason: 'Root leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(res2.status).toBe(403);
    });

    it('allows manager and hr_admin to apply for leave', async () => {
      const org = await createOrg();
      const { user: manager, token: managerToken } = await createUserAndToken(
        org.id,
        Role.manager,
        'mgr@acme.com',
      );
      const { user: hr, token: hrToken } = await createUserAndToken(
        org.id,
        Role.hr_admin,
        'hr@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(manager.id, cl.id, 2026, 10, 0, 0);
      await setLeaveBalance(hr.id, cl.id, 2026, 10, 0, 0);

      // Manager
      const res1 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          reason: 'Manager personal leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      expect(res1.status).toBe(201);

      // HR Admin
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          reason: 'HR personal leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
          ],
        });
      expect(res2.status).toBe(201);
    });
  });

  // ===========================================================================
  // 9. DETAIL VIEW (GET /leave-requests/:id)
  // ===========================================================================
  describe('GET /leave-requests/:id', () => {
    it('allows owner and HR Admin to view, while other staff and cross-tenant receive 404', async () => {
      const org1 = await createOrg('Org 1');
      const org2 = await createOrg('Org 2');

      const { user: staff1, token: tokenStaff1 } = await createUserAndToken(
        org1.id,
        Role.staff,
        'staff1@org1.com',
      );
      const { user: staff2, token: tokenStaff2 } = await createUserAndToken(
        org1.id,
        Role.staff,
        'staff2@org1.com',
      );
      const { token: tokenHr1 } = await createUserAndToken(
        org1.id,
        Role.hr_admin,
        'hr@org1.com',
      );
      const { token: tokenStaffOtherOrg } = await createUserAndToken(
        org2.id,
        Role.staff,
        'staff@org2.com',
      );

      const cl = await createLeaveType(org1.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff1.id, cl.id, 2026, 10, 0, 0);

      const createRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${tokenStaff1}`)
        .send({
          reason: 'Staff 1 leave',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              portion: Portion.full,
            },
          ],
        });
      const reqId = createRes.body.id;

      // 1. Owner views -> 200 OK
      const resOwner = await request(app.getHttpServer())
        .get(`/leave-requests/${reqId}`)
        .set('Authorization', `Bearer ${tokenStaff1}`);
      expect(resOwner.status).toBe(200);
      expect(resOwner.body.id).toBe(reqId);
      expect(resOwner.body.segments).toHaveLength(1);
      expect(resOwner.body.segmentDays).toHaveLength(1);

      // 2. HR Admin views -> 200 OK
      const resHr = await request(app.getHttpServer())
        .get(`/leave-requests/${reqId}`)
        .set('Authorization', `Bearer ${tokenHr1}`);
      expect(resHr.status).toBe(200);

      // 3. Other staff in same org -> 404
      const resOtherStaff = await request(app.getHttpServer())
        .get(`/leave-requests/${reqId}`)
        .set('Authorization', `Bearer ${tokenStaff2}`);
      expect(resOtherStaff.status).toBe(404);

      // 4. Staff in different org -> 404
      const resOtherOrg = await request(app.getHttpServer())
        .get(`/leave-requests/${reqId}`)
        .set('Authorization', `Bearer ${tokenStaffOtherOrg}`);
      expect(resOtherOrg.status).toBe(404);
    });
  });

  // ===========================================================================
  // 10. LIST PERSONAL REQUESTS (GET /leave-requests/mine)
  // ===========================================================================
  describe('GET /leave-requests/mine', () => {
    it('returns paginated personal requests with status and date overlap filters', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'mine@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 20, 0, 0);

      // Create Request 1: Nov 2 - 4
      await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Trip 1',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });

      // Create Request 2: Nov 9 - 11
      const res2 = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Trip 2',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-09',
              endDate: '2026-11-11',
              portion: Portion.full,
            },
          ],
        });

      // Cancel Request 2
      await request(app.getHttpServer())
        .post(`/leave-requests/${res2.body.id}/cancel`)
        .set('Authorization', `Bearer ${token}`);

      // 1. Get all
      const allRes = await request(app.getHttpServer())
        .get('/leave-requests/mine?page=1&limit=10')
        .set('Authorization', `Bearer ${token}`);
      expect(allRes.status).toBe(200);
      expect(allRes.body.total).toBe(2);
      expect(allRes.body.items).toHaveLength(2);

      // 2. Filter by status: pending
      const pendingRes = await request(app.getHttpServer())
        .get('/leave-requests/mine?status=pending')
        .set('Authorization', `Bearer ${token}`);
      expect(pendingRes.status).toBe(200);
      expect(pendingRes.body.total).toBe(1);
      expect(pendingRes.body.items[0].reason).toBe('Trip 1');

      // 3. Filter by date overlap: from=2026-11-01&to=2026-11-05
      const dateRes = await request(app.getHttpServer())
        .get('/leave-requests/mine?from=2026-11-01&to=2026-11-05')
        .set('Authorization', `Bearer ${token}`);
      expect(dateRes.status).toBe(200);
      expect(dateRes.body.total).toBe(1);
      expect(dateRes.body.items[0].reason).toBe('Trip 1');
    });
  });

  // ===========================================================================
  // 11. PREVIEW (POST /leave-requests/preview)
  // ===========================================================================
  describe('POST /leave-requests/preview', () => {
    it('returns breakdown and counted days without creating records or reserving balance', async () => {
      const org = await createOrg();
      const { user: staff, token } = await createUserAndToken(
        org.id,
        Role.staff,
        'preview@acme.com',
      );
      const cl = await createLeaveType(org.id, { name: 'Casual Leave' });
      await setLeaveBalance(staff.id, cl.id, 2026, 10, 0, 0);

      const previewRes = await request(app.getHttpServer())
        .post('/leave-requests/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({
          reason: 'Preview calculation',
          segments: [
            {
              leaveTypeId: cl.id,
              startDate: '2026-11-02',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.spanDays).toBe(3);
      expect(previewRes.body.countedDays).toBe(3);
      expect(previewRes.body.breakdown).toHaveLength(3);
      expect(previewRes.body.segments).toHaveLength(1);

      // Verify NO records created in DB
      const reqCount = await prisma.leaveRequest.count({
        where: { userId: staff.id },
      });
      expect(reqCount).toBe(0);

      // Verify pending balance is still 0
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
    });
  });

  // ===========================================================================
  // 12. BALANCE INVARIANT CHECK
  // ===========================================================================
  describe('Balance Invariants', () => {
    it('verifies that pending >= 0 and pending <= allocated - used across all balances in DB', async () => {
      const balances = await prisma.leaveBalance.findMany();
      for (const bal of balances) {
        const allocated = Number(bal.allocated);
        const used = Number(bal.used);
        const pending = Number(bal.pending);

        expect(pending).toBeGreaterThanOrEqual(0);
        expect(pending).toBeLessThanOrEqual(allocated - used);
      }
    });
  });
});
