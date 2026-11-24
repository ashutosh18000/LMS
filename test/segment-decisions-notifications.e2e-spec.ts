import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { NotificationType, OrgStatus, Portion, Prisma, RequestStatus, Role, SegmentStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { BalancesService } from '../src/balances/balances.service';
import { ClockService } from '../src/common/services/clock.service';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Segment-Wise Decisions & In-App Notifications E2E', () => {
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
    clockService?.setFixedToday(null);
    if (app) {
      await app.close();
    }
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

  async function assignSchedule(orgId: string, userId: string) {
    const template = await prisma.workScheduleTemplate.create({
      data: {
        orgId,
        name: `Schedule for ${userId}`,
        saturdayMode: 'off',
        alternateOffWeeks: [],
        active: true,
      },
    });

    return prisma.employeeSchedule.create({
      data: {
        orgId,
        userId,
        templateId: template.id,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        createdBy: userId,
      },
    });
  }

  // ===========================================================================
  // 1. PARTIAL APPROVAL & BALANCE COMMIT/RELEASE
  // ===========================================================================
  describe('Segment-wise Decisions (POST /approvals/:id/decide)', () => {
    it('approves WFH and rejects Casual: sets partially_approved, releases Casual balance, keeps WFH untouched, sets rejected occupancy to 0', async () => {
      const org = await createOrg();
      const { user: hr, token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: manager, token: managerToken } = await createUserAndToken(org.id, Role.manager, 'manager@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com', {
        name: 'Staff Alice',
        managerId: manager.id,
      });

      await assignSchedule(org.id, staff.id);

      const casual = await createLeaveType(org.id, { name: 'Casual Leave', deductsBalance: true });
      const wfh = await createLeaveType(org.id, { name: 'Work From Home', deductsBalance: false, isWfh: true });

      // Allocate 10 days of Casual Leave
      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: casual.id,
          year: 2026,
          allocated: 10,
          used: 0,
          pending: 0,
        },
      });

      // Staff applies for 2 segments: WFH on Tue 3 Nov, Casual on Wed 4 - Thu 5 Nov
      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Personal appointments and home repair',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-03',
              endDate: '2026-11-03',
              portion: Portion.full,
            },
            {
              leaveTypeId: casual.id,
              startDate: '2026-11-04',
              endDate: '2026-11-05',
              portion: Portion.full,
            },
          ],
        });

      expect(applyRes.status).toBe(201);
      const reqId = applyRes.body.id;
      const segments = applyRes.body.segments;
      expect(segments).toHaveLength(2);

      const wfhSeg = segments.find((s: any) => s.leaveTypeId === wfh.id);
      const casualSeg = segments.find((s: any) => s.leaveTypeId === casual.id);

      // Verify pending balance reserved for Casual (2 days)
      let bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: { userId: staff.id, leaveTypeId: casual.id, year: 2026 },
        },
      });
      expect(Number(bal?.pending)).toBe(2);
      expect(Number(bal?.used)).toBe(0);

      // HR decides: approve WFH, reject Casual with comment
      const rejectReason = 'Release critical deployment on Nov 4-5';
      const decideRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/decide`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          decisions: [
            {
              segmentId: wfhSeg.id,
              action: 'approve',
              comment: 'WFH approved',
            },
            {
              segmentId: casualSeg.id,
              action: 'reject',
              comment: rejectReason,
            },
          ],
        });

      expect(decideRes.status).toBe(200);
      expect(decideRes.body.status).toBe(RequestStatus.partially_approved);
      expect(decideRes.body.segments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: wfhSeg.id, status: SegmentStatus.approved }),
          expect.objectContaining({ id: casualSeg.id, status: SegmentStatus.rejected, comment: rejectReason }),
        ]),
      );

      // Verify Balances: Casual pending released to 0, used is 0
      bal = await prisma.leaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: { userId: staff.id, leaveTypeId: casual.id, year: 2026 },
        },
      });
      expect(Number(bal?.pending)).toBe(0);
      expect(Number(bal?.used)).toBe(0);

      // Verify Occupancy: Casual days (Nov 4 & 5) occupancy zeroed out
      const casualDays = await prisma.leaveSegmentDay.findMany({
        where: { segmentId: casualSeg.id },
      });
      for (const d of casualDays) {
        expect(Number(d.occupancy)).toBe(0);
      }

      // Verify Occupancy: WFH day (Nov 3) occupancy is 1.0
      const wfhDays = await prisma.leaveSegmentDay.findMany({
        where: { segmentId: wfhSeg.id },
      });
      for (const d of wfhDays) {
        expect(Number(d.occupancy)).toBe(1.0);
      }

      // Staff re-applies on rejected dates (Nov 4-5) - MUST SUCCEED because occupancy was 0
      const reapplyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Reapplying with WFH on Nov 4',
          segments: [
            {
              leaveTypeId: wfh.id,
              startDate: '2026-11-04',
              endDate: '2026-11-04',
              portion: Portion.full,
            },
          ],
        });
      expect(reapplyRes.status).toBe(201);
    });

    it('rejects incomplete decision with 400 Bad Request indicating missing segment', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com');
      await assignSchedule(org.id, staff.id);

      const wfh = await createLeaveType(org.id, { name: 'WFH', deductsBalance: false, isWfh: true });

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'WFH segments',
          segments: [
            { leaveTypeId: wfh.id, startDate: '2026-11-03', endDate: '2026-11-03', portion: Portion.full },
            { leaveTypeId: wfh.id, startDate: '2026-11-04', endDate: '2026-11-04', portion: Portion.full },
          ],
        });

      const reqId = applyRes.body.id;
      const seg1 = applyRes.body.segments[0];

      // Send decision for only 1 segment
      const incompleteRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/decide`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          decisions: [{ segmentId: seg1.id, action: 'approve' }],
        });

      expect(incompleteRes.status).toBe(400);
      expect(incompleteRes.body.code).toBe('MISSING_SEGMENT_DECISIONS');
      expect(incompleteRes.body.message).toMatch(/Missing segment/i);
    });

    it('rejects rejection without comment with 400 Bad Request', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com');
      await assignSchedule(org.id, staff.id);

      const wfh = await createLeaveType(org.id, { name: 'WFH', deductsBalance: false, isWfh: true });

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'WFH',
          segments: [{ leaveTypeId: wfh.id, startDate: '2026-11-03', endDate: '2026-11-03', portion: Portion.full }],
        });

      const reqId = applyRes.body.id;
      const segId = applyRes.body.segments[0].id;

      // Reject without comment
      const rejectRes = await request(app.getHttpServer())
        .post(`/approvals/${reqId}/decide`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          decisions: [{ segmentId: segId, action: 'reject' }],
        });

      expect(rejectRes.status).toBe(400);
      expect(rejectRes.body.code).toBe('DECISION_COMMENT_REQUIRED');
      expect(rejectRes.body.message).toMatch(/comment is required/i);
    });

    it('concurrency: handles double simultaneous decide with 409 Conflict', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com');
      await assignSchedule(org.id, staff.id);

      const wfh = await createLeaveType(org.id, { name: 'WFH', deductsBalance: false, isWfh: true });

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'WFH',
          segments: [{ leaveTypeId: wfh.id, startDate: '2026-11-03', endDate: '2026-11-03', portion: Portion.full }],
        });

      const reqId = applyRes.body.id;
      const segId = applyRes.body.segments[0].id;

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/decide`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send({ decisions: [{ segmentId: segId, action: 'approve' }] }),
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/decide`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send({ decisions: [{ segmentId: segId, action: 'approve' }] }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('concurrency: handles simultaneous decide and cancel with exactly 1 winner and 1 409', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com');
      await assignSchedule(org.id, staff.id);

      const wfh = await createLeaveType(org.id, { name: 'WFH', deductsBalance: false, isWfh: true });

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'WFH',
          segments: [{ leaveTypeId: wfh.id, startDate: '2026-11-03', endDate: '2026-11-03', portion: Portion.full }],
        });

      const reqId = applyRes.body.id;
      const segId = applyRes.body.segments[0].id;

      const [decideRes, cancelRes] = await Promise.all([
        request(app.getHttpServer())
          .post(`/approvals/${reqId}/decide`)
          .set('Authorization', `Bearer ${hrToken}`)
          .send({ decisions: [{ segmentId: segId, action: 'approve' }] }),
        request(app.getHttpServer())
          .post(`/leave-requests/${reqId}/cancel`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send(),
      ]);

      const statuses = [decideRes.status, cancelRes.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('permissions: enforces canDecide on /decide, /approve, and /reject (own request 403, HR on HR 403, Org Owner allowed)', async () => {
      const org = await createOrg();
      const { token: ownerToken } = await createUserAndToken(org.id, Role.org_owner, 'owner@acme.com');
      const { user: hr1, token: hr1Token } = await createUserAndToken(org.id, Role.hr_admin, 'hr1@acme.com');
      const { token: hr2Token } = await createUserAndToken(org.id, Role.hr_admin, 'hr2@acme.com');

      await assignSchedule(org.id, hr1.id);
      const wfh = await createLeaveType(org.id, { name: 'WFH', deductsBalance: false, isWfh: true });

      // Helper to submit a test request for hr1
      const applyHrRequest = async (note: string, dateStr: string = '2026-11-03') => {
        const res = await request(app.getHttpServer())
          .post('/leave-requests')
          .set('Authorization', `Bearer ${hr1Token}`)
          .send({
            reason: note,
            segments: [{ leaveTypeId: wfh.id, startDate: dateStr, endDate: dateStr, portion: Portion.full }],
          });
        return { reqId: res.body.id, segId: res.body.segments[0].id };
      };

      const reqA = await applyHrRequest('Request A', '2026-11-03');

      // 1. Own request forbidden on /decide, /approve, and /reject (403)
      const selfDecide = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/decide`)
        .set('Authorization', `Bearer ${hr1Token}`)
        .send({ decisions: [{ segmentId: reqA.segId, action: 'approve' }] });
      expect(selfDecide.status).toBe(403);

      const selfApprove = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/approve`)
        .set('Authorization', `Bearer ${hr1Token}`)
        .send({});
      expect(selfApprove.status).toBe(403);

      const selfReject = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/reject`)
        .set('Authorization', `Bearer ${hr1Token}`)
        .send({ comment: 'Cannot reject self' });
      expect(selfReject.status).toBe(403);

      // 2. HR2 decides on HR1 forbidden on /decide, /approve, and /reject (403)
      const hr2Decide = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/decide`)
        .set('Authorization', `Bearer ${hr2Token}`)
        .send({ decisions: [{ segmentId: reqA.segId, action: 'approve' }] });
      expect(hr2Decide.status).toBe(403);

      const hr2Approve = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/approve`)
        .set('Authorization', `Bearer ${hr2Token}`)
        .send({});
      expect(hr2Approve.status).toBe(403);

      const hr2Reject = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/reject`)
        .set('Authorization', `Bearer ${hr2Token}`)
        .send({ comment: 'HR cannot reject another HR' });
      expect(hr2Reject.status).toBe(403);

      // 3. Org Owner decides on HR1 allowed on all 3 endpoints
      // 3a. Org Owner decides via /decide on reqA -> 200 OK
      const ownerDecide = await request(app.getHttpServer())
        .post(`/approvals/${reqA.reqId}/decide`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ decisions: [{ segmentId: reqA.segId, action: 'approve' }] });
      expect(ownerDecide.status).toBe(200);
      expect(ownerDecide.body.status).toBe(RequestStatus.approved);

      // 3b. Org Owner decides via /approve shortcut on reqB -> 200 OK (distinct date to avoid overlap)
      const reqB = await applyHrRequest('Request B', '2026-11-04');
      const ownerApprove = await request(app.getHttpServer())
        .post(`/approvals/${reqB.reqId}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ comment: 'Owner approved' });
      expect(ownerApprove.status).toBe(200);
      expect(ownerApprove.body.status).toBe(RequestStatus.approved);

      // 3c. Org Owner decides via /reject shortcut on reqC -> 200 OK (distinct date to avoid overlap)
      const reqC = await applyHrRequest('Request C', '2026-11-05');
      const ownerReject = await request(app.getHttpServer())
        .post(`/approvals/${reqC.reqId}/reject`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ comment: 'Owner rejected' });
      expect(ownerReject.status).toBe(200);
      expect(ownerReject.body.status).toBe(RequestStatus.rejected);
    });
  });

  // ===========================================================================
  // 2. IN-APP NOTIFICATIONS & PRIVACY DEEP SCAN
  // ===========================================================================
  describe('In-App Notifications & Strict Manager Privacy', () => {
    it('creates notifications for staff (with reject comment) and manager (WITHOUT comment, reason, leave type name, balance)', async () => {
      const org = await createOrg();
      const { token: hrToken } = await createUserAndToken(org.id, Role.hr_admin, 'hr@acme.com');
      const { user: manager, token: managerToken } = await createUserAndToken(org.id, Role.manager, 'mgr@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'staff@acme.com', {
        name: 'Staff John Doe',
        managerId: manager.id,
      });

      await assignSchedule(org.id, staff.id);
      const casual = await createLeaveType(org.id, { name: 'Privileged Medical Casual Leave', deductsBalance: true });

      await prisma.leaveBalance.create({
        data: {
          orgId: org.id,
          userId: staff.id,
          leaveTypeId: casual.id,
          year: 2026,
          allocated: 10,
          used: 0,
          pending: 0,
        },
      });

      const secretComment = 'CONFIDENTIAL_HR_REJECTION_REASON_9988';
      const staffPersonalReason = 'SECRET_PERSONAL_MEDICAL_PROCEDURE';

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: staffPersonalReason,
          segments: [
            {
              leaveTypeId: casual.id,
              startDate: '2026-11-05',
              endDate: '2026-11-06',
              portion: Portion.full,
            },
          ],
        });

      const reqId = applyRes.body.id;
      const segId = applyRes.body.segments[0].id;

      // HR rejects segment with confidential comment
      await request(app.getHttpServer())
        .post(`/approvals/${reqId}/decide`)
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          decisions: [
            {
              segmentId: segId,
              action: 'reject',
              comment: secretComment,
            },
          ],
        });

      // 1. Staff Notifications: staff DOES receive secret comment
      const staffNotifRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(staffNotifRes.status).toBe(200);
      expect(staffNotifRes.body.items).toHaveLength(1);
      const staffNotif = staffNotifRes.body.items[0];
      expect(staffNotif.body).toContain(secretComment);

      // Staff Request Detail: DOES contain secret comment
      const staffReqDetail = await request(app.getHttpServer())
        .get(`/leave-requests/${reqId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffReqDetail.status).toBe(200);
      expect(staffReqDetail.body.segments[0].decisionComment).toBe(secretComment);

      // 2. Unread Count & Mark Read API test
      const unreadCountRes = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(unreadCountRes.status).toBe(200);
      expect(unreadCountRes.body.unreadCount).toBe(1);

      const markReadRes = await request(app.getHttpServer())
        .patch(`/notifications/${staffNotif.id}/read`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(markReadRes.status).toBe(200);
      expect(markReadRes.body.readAt).toBeDefined();

      const unreadCountAfter = await request(app.getHttpServer())
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(unreadCountAfter.body.unreadCount).toBe(0);

      // 3. Manager Deep Scan: Query all manager endpoints
      const managerNotifRes = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(managerNotifRes.status).toBe(200);
      expect(managerNotifRes.body.items).toHaveLength(1);

      const managerTeamAvail = await request(app.getHttpServer())
        .get('/team/availability?from=2026-11-01&to=2026-11-10')
        .set('Authorization', `Bearer ${managerToken}`);

      const managerMyTeamAvail = await request(app.getHttpServer())
        .get('/my-team/availability?from=2026-11-01&to=2026-11-10')
        .set('Authorization', `Bearer ${managerToken}`);

      const managerDashboardTeam = await request(app.getHttpServer())
        .get('/dashboard/team')
        .set('Authorization', `Bearer ${managerToken}`);

      // Deep scan all manager responses for leaks
      const managerPayloads = [
        JSON.stringify(managerNotifRes.body),
        JSON.stringify(managerTeamAvail.body),
        JSON.stringify(managerMyTeamAvail.body),
        JSON.stringify(managerDashboardTeam.body),
      ];

      for (const payload of managerPayloads) {
        // Privacy assertions:
        expect(payload).not.toContain(secretComment);
        expect(payload).not.toContain('decisionComment');
        expect(payload).not.toContain(staffPersonalReason);
        expect(payload).not.toContain('Privileged Medical Casual Leave');
        expect(payload).not.toContain('"allocated"');
        expect(payload).not.toContain('"pendingBalance"');
        expect(payload).not.toContain('"availableBalance"');
      }

      // 4. Tenant Isolation Check: User from Org B cannot see notifications
      const orgB = await createOrg('Org B Corp');
      const { token: orgBUserToken } = await createUserAndToken(orgB.id, Role.staff, 'buser@orgb.com');

      const orgBNotifs = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${orgBUserToken}`);
      expect(orgBNotifs.body.items).toHaveLength(0);

      const crossOrgRead = await request(app.getHttpServer())
        .patch(`/notifications/${staffNotif.id}/read`)
        .set('Authorization', `Bearer ${orgBUserToken}`);
      expect(crossOrgRead.status).toBe(404);
    });

    it('self-action: does not send notification to staff when staff cancels own request, but sends to manager', async () => {
      const org = await createOrg();
      const { user: manager, token: managerToken } = await createUserAndToken(org.id, Role.manager, 'cancelmgr@acme.com');
      const { user: staff, token: staffToken } = await createUserAndToken(org.id, Role.staff, 'cancelstaff@acme.com', {
        managerId: manager.id,
      });
      await assignSchedule(org.id, staff.id);
      const wfh = await createLeaveType(org.id, { name: 'WFH', deductsBalance: false, isWfh: true });

      const applyRes = await request(app.getHttpServer())
        .post('/leave-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          reason: 'Planning WFH day',
          segments: [{ leaveTypeId: wfh.id, startDate: '2026-11-12', endDate: '2026-11-12', portion: Portion.full }],
        });
      const reqId = applyRes.body.id;

      // Staff cancels their own pending leave request
      const cancelRes = await request(app.getHttpServer())
        .post(`/leave-requests/${reqId}/cancel`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send();
      expect(cancelRes.status).toBe(200);

      // Staff should have 0 notifications (self-action rule: no notification for own action)
      const staffNotifs = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffNotifs.status).toBe(200);
      expect(staffNotifs.body.items).toHaveLength(0);

      // Manager MUST receive 1 notification informing them of the team member cancellation
      const managerNotifs = await request(app.getHttpServer())
        .get('/notifications')
        .set('Authorization', `Bearer ${managerToken}`);
      expect(managerNotifs.status).toBe(200);
      expect(managerNotifs.body.items).toHaveLength(1);
      expect(managerNotifs.body.items[0].type).toBe(NotificationType.leave_cancelled);
      expect(managerNotifs.body.items[0].body).toContain('WFH');
    });
  });
});
