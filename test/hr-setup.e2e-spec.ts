import * as path from "path";
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { OrgStatus, Role, SaturdayMode } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { AuditAction } from '../src/audit/audit.service';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('HR Setup Modules E2E (Users, Schedules, LeaveTypes, Holidays)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;

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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanTestDatabase(prisma);
  });

  // Helper to create an organization with an HR Admin and return access token
  async function createOrgAndHrAdmin(orgName = 'Acme Corp', hrEmail = 'hr@acme.com'): Promise<{
    org: any;
    hrUser: any;
    token: string;
  }> {
    const org = await prisma.organization.create({
      data: {
        name: orgName,
        status: OrgStatus.active,
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

  // Helper to create staff user and get their token
  async function createStaffAndToken(orgId: string, email = 'staff@acme.com'): Promise<{
    user: any;
    token: string;
  }> {
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
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'StaffPass123!' });

    return { user, token: loginRes.body.accessToken };
  }

  // ===========================================================================
  // 1. USERS MODULE
  // ===========================================================================
  describe('Users Management (/users)', () => {
    it('HR can create staff and manager users; validates manager rules & duplicate email', async () => {
      const { token } = await createOrgAndHrAdmin();

      // 1. Create a Manager
      const managerRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Sales Manager',
          email: 'manager@acme.com',
          role: 'manager',
          tempPassword: 'Password123!',
          department: 'Sales',
        });

      expect(managerRes.status).toBe(201);
      expect(managerRes.body.id).toBeDefined();
      expect(managerRes.body.role).toBe(Role.manager);
      expect(managerRes.body.managerId).toBeNull();
      expect(managerRes.body.passwordHash).toBeUndefined(); // Never leaked

      const managerId = managerRes.body.id;

      // 2. Manager cannot have managerId
      const invalidManagerRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Senior Manager',
          email: 'senior.mgr@acme.com',
          role: 'manager',
          managerId,
          tempPassword: 'Password123!',
        });
      expect(invalidManagerRes.status).toBe(400);

      // 3. Create Staff with valid managerId
      const staffRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Sales Exec',
          email: 'exec@acme.com',
          role: 'staff',
          managerId,
          department: 'Sales',
          joiningDate: '2026-01-15',
          tempPassword: 'Password123!',
        });
      expect(staffRes.status).toBe(201);
      expect(staffRes.body.role).toBe(Role.staff);
      expect(staffRes.body.managerId).toBe(managerId);

      // 4. Duplicate email fails with 409
      const dupRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Duplicate Exec',
          email: 'exec@acme.com',
          role: 'staff',
          tempPassword: 'Password123!',
        });
      expect(dupRes.status).toBe(409);
    });

    it('GET /users supports pagination, search, role and department filters', async () => {
      const { token } = await createOrgAndHrAdmin();

      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Alice Manager',
          email: 'alice@acme.com',
          role: 'manager',
          department: 'Engineering',
          tempPassword: 'Password123!',
        });

      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Bob Staff',
          email: 'bob@acme.com',
          role: 'staff',
          department: 'Marketing',
          tempPassword: 'Password123!',
        });

      // Filter by role = manager
      const mgrList = await request(app.getHttpServer())
        .get('/users?role=manager')
        .set('Authorization', `Bearer ${token}`);
      expect(mgrList.status).toBe(200);
      expect(mgrList.body.items).toHaveLength(1);
      expect(mgrList.body.items[0].name).toBe('Alice Manager');

      // Filter by department = Marketing
      const deptList = await request(app.getHttpServer())
        .get('/users?department=Marketing')
        .set('Authorization', `Bearer ${token}`);
      expect(deptList.status).toBe(200);
      expect(deptList.body.items).toHaveLength(1);
      expect(deptList.body.items[0].name).toBe('Bob Staff');

      // Search by name
      const searchList = await request(app.getHttpServer())
        .get('/users?search=alice')
        .set('Authorization', `Bearer ${token}`);
      expect(searchList.status).toBe(200);
      expect(searchList.body.items).toHaveLength(1);
      expect(searchList.body.items[0].name).toBe('Alice Manager');
    });

    it('hr_admin, org_owner, and root users are not visible or modifiable via /users (404)', async () => {
      const { org, hrUser, token } = await createOrgAndHrAdmin();

      // Create owner user
      const hash = await passwordService.hash('OwnerPass123!');
      const owner = await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'owner@acme.com',
          name: 'Org Owner',
          passwordHash: hash,
          role: Role.org_owner,
          active: true,
        },
      });

      // Try GET /users/:id with hrUser id -> 404
      const hrGet = await request(app.getHttpServer())
        .get(`/users/${hrUser.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(hrGet.status).toBe(404);

      // Try GET /users/:id with owner id -> 404
      const ownerGet = await request(app.getHttpServer())
        .get(`/users/${owner.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(ownerGet.status).toBe(404);

      // Try PATCH /users/:id with owner id -> 404
      const ownerPatch = await request(app.getHttpServer())
        .patch(`/users/${owner.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Hacked Name' });
      expect(ownerPatch.status).toBe(404);
    });

    it('prevents demoting or deactivating a manager who has direct reports (409) until reassigned', async () => {
      const { token } = await createOrgAndHrAdmin();

      // Create Manager 1
      const m1Res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Manager One',
          email: 'm1@acme.com',
          role: 'manager',
          tempPassword: 'Password123!',
        });
      const m1Id = m1Res.body.id;

      // Create Staff reporting to Manager 1
      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Staff Under M1',
          email: 'staff.m1@acme.com',
          role: 'staff',
          managerId: m1Id,
          tempPassword: 'Password123!',
        });

      // Attempt 1: Demote Manager 1 to staff -> MUST return 409 Conflict
      const demoteRes = await request(app.getHttpServer())
        .patch(`/users/${m1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role: 'staff' });
      expect(demoteRes.status).toBe(409);
      expect(demoteRes.body.message).toContain('direct report');

      // Attempt 2: Deactivate Manager 1 -> MUST return 409 Conflict
      const deactRes = await request(app.getHttpServer())
        .patch(`/users/${m1Id}/deactivate`)
        .set('Authorization', `Bearer ${token}`);
      expect(deactRes.status).toBe(409);

      // Create Manager 2
      const m2Res = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Manager Two',
          email: 'm2@acme.com',
          role: 'manager',
          tempPassword: 'Password123!',
        });
      const m2Id = m2Res.body.id;

      // Reassign reports from Manager 1 to Manager 2
      const reassignRes = await request(app.getHttpServer())
        .post(`/users/${m1Id}/reassign-reports`)
        .set('Authorization', `Bearer ${token}`)
        .send({ newManagerId: m2Id });
      expect(reassignRes.status).toBe(200);
      expect(reassignRes.body.reassignedCount).toBe(1);

      // Now deactivating Manager 1 succeeds!
      const deactSuccess = await request(app.getHttpServer())
        .patch(`/users/${m1Id}/deactivate`)
        .set('Authorization', `Bearer ${token}`);
      expect(deactSuccess.status).toBe(200);
      expect(deactSuccess.body.user.active).toBe(false);

      // Reactivating Manager 1 succeeds
      const reactivateRes = await request(app.getHttpServer())
        .patch(`/users/${m1Id}/reactivate`)
        .set('Authorization', `Bearer ${token}`);
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.user.active).toBe(true);
    });

    it('reset-password revokes all existing refresh tokens and sets mustChangePassword', async () => {
      const { token } = await createOrgAndHrAdmin();

      const userRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Charlie Staff',
          email: 'charlie@acme.com',
          role: 'staff',
          tempPassword: 'OldPassword123!',
        });
      const charlieId = userRes.body.id;

      // Charlie logs in
      const charlieLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'charlie@acme.com', password: 'OldPassword123!' });
      expect(charlieLogin.status).toBe(200);

      // Verify a refresh token was created in DB
      const tokensBefore = await prisma.refreshToken.count({
        where: { userId: charlieId },
      });
      expect(tokensBefore).toBeGreaterThan(0);

      // HR resets Charlie's password
      const resetRes = await request(app.getHttpServer())
        .post(`/users/${charlieId}/reset-password`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tempPassword: 'NewPassword123!' });
      expect(resetRes.status).toBe(200);

      // Verify tokens revoked
      const tokensAfter = await prisma.refreshToken.count({
        where: { userId: charlieId },
      });
      expect(tokensAfter).toBe(0);

      // Verify old password fails
      const failedLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'charlie@acme.com', password: 'OldPassword123!' });
      expect(failedLogin.status).toBe(401);

      // Verify new password succeeds with mustChangePassword = true
      const newLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'charlie@acme.com', password: 'NewPassword123!' });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.mustChangePassword).toBe(true);
    });
  });

  // ===========================================================================
  // 2. WORK SCHEDULES MODULE
  // ===========================================================================
  describe('Work Schedules (/schedule-templates & /me/schedule)', () => {
    it('creates schedule templates with Saturday mode validation, allows assignment and viewing', async () => {
      const { org, token } = await createOrgAndHrAdmin();
      const { user: staff, token: staffToken } = await createStaffAndToken(org.id);

      // 1. Alternate mode requires [1, 3] or [2, 4]
      const invalidAlt = await request(app.getHttpServer())
        .post('/schedule-templates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Invalid Alternate',
          saturdayMode: 'alternate',
          alternateOffWeeks: [1, 2], // Invalid!
        });
      expect(invalidAlt.status).toBe(400);

      // 2. Create valid Alternate Saturday template
      const templateRes = await request(app.getHttpServer())
        .post('/schedule-templates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Alternate Sat Off',
          saturdayMode: 'alternate',
          alternateOffWeeks: [1, 3],
        });
      expect(templateRes.status).toBe(201);
      const templateId = templateRes.body.id;

      // 3. Assign schedule to staff
      const assignRes = await request(app.getHttpServer())
        .post(`/users/${staff.id}/schedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          templateId,
          effectiveFrom: '2026-05-01',
        });
      expect(assignRes.status).toBe(201);
      expect(assignRes.body.templateId).toBe(templateId);

      // 4. Duplicate assignment on same effective date returns 409
      const dupAssign = await request(app.getHttpServer())
        .post(`/users/${staff.id}/schedule`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          templateId,
          effectiveFrom: '2026-05-01',
        });
      expect(dupAssign.status).toBe(409);

      // 5. Staff accesses GET /me/schedule
      const meScheduleRes = await request(app.getHttpServer())
        .get('/me/schedule')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(meScheduleRes.status).toBe(200);
      expect(meScheduleRes.body.history).toHaveLength(1);
      expect(meScheduleRes.body.history[0].templateId).toBe(templateId);

      // 6. Deactivating template currently in use by active employee returns 409!
      const deactBlocked = await request(app.getHttpServer())
        .patch(`/schedule-templates/${templateId}/deactivate`)
        .set('Authorization', `Bearer ${token}`);
      expect(deactBlocked.status).toBe(409);
      expect(deactBlocked.body.message).toContain('active employees');
    });

    it('lists templates with active filter and allows GET /schedule-templates/:id', async () => {
      const { token } = await createOrgAndHrAdmin();

      const t1 = await request(app.getHttpServer())
        .post('/schedule-templates')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Standard 5-Day', saturdayMode: 'off' });

      const t2 = await request(app.getHttpServer())
        .post('/schedule-templates')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '6-Day Workweek', saturdayMode: 'full' });

      // Deactivate t2
      await request(app.getHttpServer())
        .patch(`/schedule-templates/${t2.body.id}/deactivate`)
        .set('Authorization', `Bearer ${token}`);

      // Query active=true
      const activeOnly = await request(app.getHttpServer())
        .get('/schedule-templates?active=true')
        .set('Authorization', `Bearer ${token}`);
      expect(activeOnly.status).toBe(200);
      expect(activeOnly.body).toHaveLength(1);
      expect(activeOnly.body[0].name).toBe('Standard 5-Day');

      // GET by id
      const detail = await request(app.getHttpServer())
        .get(`/schedule-templates/${t1.body.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.name).toBe('Standard 5-Day');
    });
  });

  // ===========================================================================
  // 3. LEAVE TYPES MODULE
  // ===========================================================================
  describe('Leave Types (/leave-types)', () => {
    it('enforces WFH rules: deductsBalance must be false, daysPerYear null, carryForwardMax 0', async () => {
      const { token } = await createOrgAndHrAdmin();

      // WFH with deductsBalance true -> 400
      const inv1 = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'WFH Invalid 1',
          paid: true,
          isWfh: true,
          deductsBalance: true, // Invalid!
          halfDayAllowed: true,
        });
      expect(inv1.status).toBe(400);

      // WFH with daysPerYear -> 400
      const inv2 = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'WFH Invalid 2',
          paid: true,
          isWfh: true,
          deductsBalance: false,
          daysPerYear: 10, // Invalid!
          halfDayAllowed: true,
        });
      expect(inv2.status).toBe(400);

      // Valid WFH
      const validWfh = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Work From Home',
          paid: true,
          isWfh: true,
          deductsBalance: false,
          halfDayAllowed: true,
        });
      expect(validWfh.status).toBe(201);
      expect(validWfh.body.isWfh).toBe(true);
      expect(validWfh.body.deductsBalance).toBe(false);
    });

    it('enforces carryForwardMax <= daysPerYear and deductsBalance requires daysPerYear', async () => {
      const { token } = await createOrgAndHrAdmin();

      // deductsBalance true without daysPerYear -> 400
      const invNoDays = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Annual Leave Missing Days',
          paid: true,
          deductsBalance: true,
          isWfh: false,
          halfDayAllowed: true,
        });
      expect(invNoDays.status).toBe(400);

      // carryForwardMax > daysPerYear -> 400
      const invCarry = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Sick Leave Excess Carry',
          paid: true,
          deductsBalance: true,
          daysPerYear: 10,
          carryForwardMax: 15, // Invalid!
          isWfh: false,
          halfDayAllowed: true,
        });
      expect(invCarry.status).toBe(400);

      // Valid Paid Leave
      const validPl = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Earned Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: 18,
          carryForwardMax: 6,
          isWfh: false,
          halfDayAllowed: true,
        });
      expect(validPl.status).toBe(201);
    });

    it('non-HR users receive sanitized projection on GET /leave-types, while HR receives full entity', async () => {
      const { org, token: hrToken } = await createOrgAndHrAdmin();
      const { token: staffToken } = await createStaffAndToken(org.id);

      await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({
          name: 'Casual Leave',
          paid: true,
          deductsBalance: true,
          daysPerYear: 12,
          carryForwardMax: 0,
          monthlyLimit: 2,
          isWfh: false,
          halfDayAllowed: true,
        });

      // Staff query
      const staffRes = await request(app.getHttpServer())
        .get('/leave-types')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(staffRes.status).toBe(200);
      expect(staffRes.body[0].name).toBe('Casual Leave');
      expect(staffRes.body[0].daysPerYear).toBeUndefined(); // Hidden from staff
      expect(staffRes.body[0].monthlyLimit).toBeUndefined(); // Hidden from staff
      expect(staffRes.body[0].carryForwardMax).toBeUndefined(); // Hidden from staff
      expect(staffRes.body[0].deductsBalance).toBeDefined();

      // HR query
      const hrRes = await request(app.getHttpServer())
        .get('/leave-types')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(hrRes.status).toBe(200);
      expect(hrRes.body[0].daysPerYear).toBeDefined();
    });

    it('isWfh is immutable on PATCH /leave-types/:id', async () => {
      const { token } = await createOrgAndHrAdmin();

      const created = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Remote Day',
          paid: true,
          isWfh: true,
          deductsBalance: false,
          halfDayAllowed: false,
        });

      const patchRes = await request(app.getHttpServer())
        .patch(`/leave-types/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isWfh: false }); // Cannot change!

      expect(patchRes.status).toBe(400);
    });
  });

  // ===========================================================================
  // 4. HOLIDAYS MODULE
  // ===========================================================================
  describe('Holidays (/holidays)', () => {
    it('creates holidays, rejects duplicate active date (409), reactivates inactive on re-add', async () => {
      const { token } = await createOrgAndHrAdmin();

      // 1. Create Independence Day
      const h1 = await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Independence Day',
          date: '2026-08-15',
        });
      expect(h1.status).toBe(201);
      const h1Id = h1.body.id;

      // 2. Duplicate active date returns 409
      const dup = await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Duplicate 15 Aug',
          date: '2026-08-15',
        });
      expect(dup.status).toBe(409);

      // 3. Deactivate holiday
      const deact = await request(app.getHttpServer())
        .patch(`/holidays/${h1Id}/deactivate`)
        .set('Authorization', `Bearer ${token}`);
      expect(deact.status).toBe(200);
      expect(deact.body.active).toBe(false);

      // 4. Re-adding the inactive date reactivates and updates name
      const readd = await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Independence Day Celebrations',
          date: '2026-08-15',
        });
      expect(readd.status).toBe(201);
      expect(readd.body.id).toBe(h1Id);
      expect(readd.body.active).toBe(true);
      expect(readd.body.name).toBe('Independence Day Celebrations');
    });

    it('GET /holidays filters by year, orders asc, and is accessible to staff', async () => {
      const { org, token: hrToken } = await createOrgAndHrAdmin();
      const { token: staffToken } = await createStaffAndToken(org.id);

      await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'Christmas 2026', date: '2026-12-25' });

      await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'Republic Day 2026', date: '2026-01-26' });

      await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${hrToken}`)
        .send({ name: 'New Year 2027', date: '2027-01-01' });

      // Staff query year 2026 -> returns 2 holidays sorted asc
      const res2026 = await request(app.getHttpServer())
        .get('/holidays?year=2026')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res2026.status).toBe(200);
      expect(res2026.body).toHaveLength(2);
      expect(res2026.body[0].name).toBe('Republic Day 2026');
      expect(res2026.body[1].name).toBe('Christmas 2026');

      // Staff query year 2027
      const res2027 = await request(app.getHttpServer())
        .get('/holidays?year=2027')
        .set('Authorization', `Bearer ${staffToken}`);
      expect(res2027.status).toBe(200);
      expect(res2027.body).toHaveLength(1);
      expect(res2027.body[0].name).toBe('New Year 2027');

      // HR manage endpoint returns active + inactive
      const manageRes = await request(app.getHttpServer())
        .get('/holidays/manage')
        .set('Authorization', `Bearer ${hrToken}`);
      expect(manageRes.status).toBe(200);
      expect(manageRes.body).toHaveLength(3);
    });
  });

  // ===========================================================================
  // 5. TENANT ISOLATION & ROLE GUARDS
  // ===========================================================================
  describe('Tenant Isolation & Role Guards', () => {
    it('prevents HR Admin of Org A from modifying or viewing resources in Org B (404)', async () => {
      const { token: hrTokenA } = await createOrgAndHrAdmin('Org A', 'hr.a@orga.com');
      const { token: hrTokenB } = await createOrgAndHrAdmin('Org B', 'hr.b@orgb.com');

      // Create a user in Org B
      const userB = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${hrTokenB}`)
        .send({
          name: 'Staff in Org B',
          email: 'staff.b@orgb.com',
          role: 'staff',
          tempPassword: 'Password123!',
        });
      const userBId = userB.body.id;

      // HR Admin A tries to GET user in Org B -> 404
      const crossGet = await request(app.getHttpServer())
        .get(`/users/${userBId}`)
        .set('Authorization', `Bearer ${hrTokenA}`);
      expect(crossGet.status).toBe(404);

      // HR Admin A tries to PATCH user in Org B -> 404
      const crossPatch = await request(app.getHttpServer())
        .patch(`/users/${userBId}`)
        .set('Authorization', `Bearer ${hrTokenA}`)
        .send({ name: 'Hacked Name' });
      expect(crossPatch.status).toBe(404);

      // Create holiday in Org B
      const holB = await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${hrTokenB}`)
        .send({ name: 'Org B Holiday', date: '2026-11-20' });

      // HR Admin A tries to deactivate holiday in Org B -> 404
      const crossHol = await request(app.getHttpServer())
        .patch(`/holidays/${holB.body.id}/deactivate`)
        .set('Authorization', `Bearer ${hrTokenA}`);
      expect(crossHol.status).toBe(404);
    });

    it('prevents staff user from calling write endpoints (403 Forbidden)', async () => {
      const { org } = await createOrgAndHrAdmin();
      const { token: staffToken } = await createStaffAndToken(org.id);

      // Staff tries POST /users -> 403
      const uRes = await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'New Guy', email: 'guy@acme.com', role: 'staff', tempPassword: 'Pass123!' });
      expect(uRes.status).toBe(403);

      // Staff tries POST /schedule-templates -> 403
      const sRes = await request(app.getHttpServer())
        .post('/schedule-templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'New Template', saturdayMode: 'off' });
      expect(sRes.status).toBe(403);

      // Staff tries POST /leave-types -> 403
      const lRes = await request(app.getHttpServer())
        .post('/leave-types')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'Illegal Leave', paid: true, deductsBalance: false, isWfh: false, halfDayAllowed: true });
      expect(lRes.status).toBe(403);

      // Staff tries POST /holidays -> 403
      const hRes = await request(app.getHttpServer())
        .post('/holidays')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ name: 'Illegal Holiday', date: '2026-12-31' });
      expect(hRes.status).toBe(403);
    });

    it('creates audit log entries for HR actions', async () => {
      const { org, hrUser, token } = await createOrgAndHrAdmin();

      await request(app.getHttpServer())
        .post('/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Audited Staff',
          email: 'audit.staff@acme.com',
          role: 'staff',
          tempPassword: 'Password123!',
        });

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          orgId: org.id,
          actorId: hrUser.id,
          action: AuditAction.USER_CREATED,
        },
      });

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe(AuditAction.USER_CREATED);
    });
  });
});
