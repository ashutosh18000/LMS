import * as path from "path";
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import { OrgStatus, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';
import { cleanTestDatabase } from './test-helpers';

dotenv.config({ path: path.resolve(__dirname, "../.env.test") });

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
}

describe('Platform (Root) & Org (Owner) Modules E2E', () => {
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

  // Strict cleanup before each test
  beforeEach(async () => {
    await cleanTestDatabase(prisma);
  });

  // Helper to create root user and return access token
  async function createRootAndGetToken(): Promise<{ rootUser: any; token: string }> {
    const hash = await passwordService.hash('RootSecret123!');
    const rootUser = await prisma.user.create({
      data: {
        email: 'root@platform.com',
        name: 'Platform Root',
        passwordHash: hash,
        role: Role.root,
        orgId: null,
        mustChangePassword: false,
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'root@platform.com', password: 'RootSecret123!' });

    return { rootUser, token: loginRes.body.accessToken };
  }

  // Helper to create org and owner and return access token
  async function createOrgWithOwner(
    orgName = 'Acme Corp',
    ownerEmail = 'owner@acme.com',
    ownerPass = 'OwnerPass123!',
  ): Promise<{ org: any; owner: any; token: string }> {
    const org = await prisma.organization.create({
      data: {
        name: orgName,
        status: OrgStatus.active,
        timezone: 'Asia/Kolkata',
        financialYearStartMonth: 4,
        workingDays: [1, 2, 3, 4, 5],
        backdateAllowedDays: 7,
      },
    });

    const hash = await passwordService.hash(ownerPass);
    const owner = await prisma.user.create({
      data: {
        orgId: org.id,
        email: ownerEmail.toLowerCase().trim(),
        name: 'Org Owner',
        passwordHash: hash,
        role: Role.org_owner,
        mustChangePassword: false,
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ownerEmail.toLowerCase().trim(), password: ownerPass });

    if (!loginRes.body.accessToken) {
      console.log('Login failed for', ownerEmail, 'status:', loginRes.status, 'body:', loginRes.body);
    }

    return { org, owner, token: loginRes.body.accessToken };
  }

  // ===========================================================================
  // ROOT / PLATFORM ENDPOINT TESTS
  // ===========================================================================
  describe('ROOT /platform Endpoints', () => {
    it('0. verifies raw SQL constraints uq_one_active_owner_per_org, uq_single_root, and chk_user_root_org exist in DB', async () => {
      const indexes: any[] = await prisma.$queryRaw`
        SELECT indexname FROM pg_indexes 
        WHERE tablename = 'User' AND indexname IN ('uq_one_active_owner_per_org', 'uq_single_root');
      `;
      const indexNames = indexes.map((i) => i.indexname);
      expect(indexNames).toContain('uq_one_active_owner_per_org');
      expect(indexNames).toContain('uq_single_root');

      const constraints: any[] = await prisma.$queryRaw`
        SELECT conname FROM pg_constraint 
        WHERE conname = 'chk_user_root_org';
      `;
      const constraintNames = constraints.map((c) => c.conname);
      expect(constraintNames).toContain('chk_user_root_org');
    });

    it('1. POST /platform/organizations - creates org + owner atomically; duplicate email rolls back with 409', async () => {
      const { token: rootToken } = await createRootAndGetToken();

      // Successful creation
      const res = await request(app.getHttpServer())
        .post('/platform/organizations')
        .set('Authorization', `Bearer ${rootToken}`)
        .send({
          orgName: 'Alpha Tech',
          ownerName: 'Alice Owner',
          ownerEmail: 'alice@alphatech.com',
          tempPassword: 'TempPassword123!',
        })
        .expect(201);

      expect(res.body.organization.name).toBe('Alpha Tech');
      expect(res.body.owner.email).toBe('alice@alphatech.com');
      expect(res.body.owner.role).toBe(Role.org_owner);

      // Verify DB state
      const createdOrg = await prisma.organization.findUnique({
        where: { id: res.body.organization.id },
      });
      expect(createdOrg?.workingDays).toEqual([1, 2, 3, 4, 5]);

      const createdOwner = await prisma.user.findUnique({
        where: { email: 'alice@alphatech.com' },
      });
      expect(createdOwner?.mustChangePassword).toBe(true);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: createdOrg?.id, action: 'ORG_CREATED' },
      });
      expect(audit).toBeDefined();

      // Duplicate email attempt -> must return 409 and not create any organization
      const initialOrgCount = await prisma.organization.count();
      const duplicateRes = await request(app.getHttpServer())
        .post('/platform/organizations')
        .set('Authorization', `Bearer ${rootToken}`)
        .send({
          orgName: 'Beta Tech',
          ownerName: 'Bob Duplicate',
          ownerEmail: 'alice@alphatech.com', // Duplicate email
          tempPassword: 'TempPassword123!',
        })
        .expect(409);

      expect(duplicateRes.body.message).toBe('Email already in use');
      const finalOrgCount = await prisma.organization.count();
      expect(finalOrgCount).toBe(initialOrgCount); // Rollback / nothing created
    });

    it('2. GET /platform/organizations - pagination and list details', async () => {
      const { token: rootToken } = await createRootAndGetToken();
      await createOrgWithOwner('Org 1', 'owner1@org1.com');
      await createOrgWithOwner('Org 2', 'owner2@org2.com');

      const res = await request(app.getHttpServer())
        .get('/platform/organizations?page=1&limit=10')
        .set('Authorization', `Bearer ${rootToken}`)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items[0]).toHaveProperty('owner');
      expect(res.body.items[0]).toHaveProperty('activeUsersCount');
    });

    it('3. Non-root user receives 403 on /platform endpoints', async () => {
      const { token: ownerToken } = await createOrgWithOwner();

      await request(app.getHttpServer())
        .get('/platform/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .post('/platform/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          orgName: 'Forbidden Corp',
          ownerName: 'No Way',
          ownerEmail: 'noway@forbidden.com',
          tempPassword: 'Password123!',
        })
        .expect(403);
    });

    it('4. PATCH /platform/organizations/:id/suspend and activate - blocks user login and revokes running token', async () => {
      const { token: rootToken } = await createRootAndGetToken();
      const { org, owner, token: ownerToken } = await createOrgWithOwner();

      // Running token works initially
      await request(app.getHttpServer())
        .get('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Root suspends organization
      await request(app.getHttpServer())
        .patch(`/platform/organizations/${org.id}/suspend`)
        .set('Authorization', `Bearer ${rootToken}`)
        .send({ reason: 'Non-payment of subscription' })
        .expect(200);

      // Running token is immediately rejected with 401
      const blockedTokenRes = await request(app.getHttpServer())
        .get('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(401);
      expect(blockedTokenRes.body.message).toBe('Organization is suspended');

      // Login attempt is blocked with 401
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: owner.email, password: 'OwnerPass123!' })
        .expect(401);
      expect(loginRes.body.message).toBe('Organization is suspended');

      // Root activates organization back
      await request(app.getHttpServer())
        .patch(`/platform/organizations/${org.id}/activate`)
        .set('Authorization', `Bearer ${rootToken}`)
        .send({ reason: 'Payment received' })
        .expect(200);

      // Login works again
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: owner.email, password: 'OwnerPass123!' })
        .expect(200);
    });

    it('5. POST /platform/organizations/:id/replace-owner - preserves partial unique index and revokes tokens', async () => {
      const { token: rootToken } = await createRootAndGetToken();
      const { org, owner } = await createOrgWithOwner();

      // Create an active staff user in same org to become new owner
      const hash = await passwordService.hash('StaffPass123!');
      const candidate = await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'candidate@acme.com',
          name: 'Candidate User',
          passwordHash: hash,
          role: Role.staff,
          active: true,
        },
      });

      // Give candidate an active refresh token
      await prisma.refreshToken.create({
        data: {
          id: '11111111-1111-1111-1111-111111111111',
          userId: candidate.id,
          tokenHash: 'dummyhash',
          expiresAt: new Date(Date.now() + 1000000),
        },
      });

      // Replace owner
      const res = await request(app.getHttpServer())
        .post(`/platform/organizations/${org.id}/replace-owner`)
        .set('Authorization', `Bearer ${rootToken}`)
        .send({
          newOwnerUserId: candidate.id,
          reason: 'Executive transition',
        })
        .expect(200);

      expect(res.body.previousOwnerId).toBe(owner.id);
      expect(res.body.newOwnerId).toBe(candidate.id);

      // Verify roles in DB
      const updatedOldOwner = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(updatedOldOwner?.role).toBe(Role.hr_admin);

      const updatedNewOwner = await prisma.user.findUnique({ where: { id: candidate.id } });
      expect(updatedNewOwner?.role).toBe(Role.org_owner);

      // Verify partial unique index was not violated and tokens were deleted
      const tokens = await prisma.refreshToken.findMany({
        where: { userId: { in: [owner.id, candidate.id] } },
      });
      expect(tokens.length).toBe(0);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, action: 'OWNER_REPLACED' },
      });
      expect(audit).toBeDefined();
    });

    it('6. POST /platform/organizations/:id/reset-owner-password - resets password and sets mustChangePassword', async () => {
      const { token: rootToken } = await createRootAndGetToken();
      const { org, owner } = await createOrgWithOwner();

      const res = await request(app.getHttpServer())
        .post(`/platform/organizations/${org.id}/reset-owner-password`)
        .set('Authorization', `Bearer ${rootToken}`)
        .send({
          tempPassword: 'NewTempPassword123!',
          reason: 'Owner locked out',
        })
        .expect(200);

      expect(res.body.ownerId).toBe(owner.id);

      const updatedOwner = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(updatedOwner?.mustChangePassword).toBe(true);

      // Verify owner can log in with new temp password
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: owner.email, password: 'NewTempPassword123!' })
        .expect(200);

      expect(loginRes.body.mustChangePassword).toBe(true);
    });
  });

  // ===========================================================================
  // ORG OWNER ENDPOINT TESTS
  // ===========================================================================
  describe('ORG OWNER /org Endpoints', () => {
    it('7. Settings update - validates IANA timezone and logs before/after in audit', async () => {
      const { org, token: ownerToken } = await createOrgWithOwner();

      // Invalid timezone should fail with 400
      await request(app.getHttpServer())
        .patch('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ timezone: 'Invalid/City_Name_123' })
        .expect(400);

      // Duplicate working days should fail with 400
      await request(app.getHttpServer())
        .patch('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ workingDays: [1, 2, 2, 4] })
        .expect(400);

      // Valid update
      const updateRes = await request(app.getHttpServer())
        .patch('/org/settings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Acme Global',
          timezone: 'America/New_York',
          financialYearStartMonth: 1,
          workingDays: [1, 2, 3, 4, 5, 6],
          backdateAllowedDays: 14,
        })
        .expect(200);

      expect(updateRes.body.settings.timezone).toBe('America/New_York');
      expect(updateRes.body.settings.workingDays).toEqual([1, 2, 3, 4, 5, 6]);

      // Check audit log contains before & after
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, action: 'ORG_SETTINGS_UPDATED' },
      });
      expect(audit).toBeDefined();
      expect((audit?.metadata as any).before.timezone).toBe('Asia/Kolkata');
      expect((audit?.metadata as any).after.timezone).toBe('America/New_York');
    });

    it('8. HR Admin Management - create, promote, demote, deactivate (last HR confirmation), reactivate', async () => {
      const { org, token: ownerToken } = await createOrgWithOwner();

      // 1. Create HR Admin
      const createHrRes = await request(app.getHttpServer())
        .post('/org/hr-admins')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'First HR',
          email: 'hr1@acme.com',
          tempPassword: 'HrPassword123!',
        })
        .expect(201);

      expect(createHrRes.body.role).toBe(Role.hr_admin);
      const hrId = createHrRes.body.id;

      // Duplicate email returns 409
      await request(app.getHttpServer())
        .post('/org/hr-admins')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Duplicate HR',
          email: 'hr1@acme.com',
          tempPassword: 'HrPassword123!',
        })
        .expect(409);

      // 2. Promote manager with reports -> must fail with 409
      const hash = await passwordService.hash('Pass123!');
      const manager = await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'manager@acme.com',
          name: 'Team Manager',
          passwordHash: hash,
          role: Role.manager,
          active: true,
        },
      });

      // Create subordinate reporting to manager
      await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'subordinate@acme.com',
          name: 'Subordinate',
          passwordHash: hash,
          role: Role.staff,
          managerId: manager.id,
          active: true,
        },
      });

      const promoteConflictRes = await request(app.getHttpServer())
        .post('/org/hr-admins/promote')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: manager.id })
        .expect(409);

      expect(promoteConflictRes.body.message).toContain('1 direct report');

      // Promote regular staff without reports -> succeeds
      const staff = await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'staff_candidate@acme.com',
          name: 'Staff Candidate',
          passwordHash: hash,
          role: Role.staff,
          active: true,
        },
      });

      const promoteRes = await request(app.getHttpServer())
        .post('/org/hr-admins/promote')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: staff.id })
        .expect(200);

      expect(promoteRes.body.user.role).toBe(Role.hr_admin);

      // 3. Demote HR Admin to staff
      const demoteRes = await request(app.getHttpServer())
        .post(`/org/hr-admins/${staff.id}/demote`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ newRole: Role.staff })
        .expect(200);

      expect(demoteRes.body.user.role).toBe(Role.staff);

      // 4. Deactivate HR Admin: Now hrId is the ONLY active HR admin
      // Deactivating without confirmLastHr: true must return 409
      const lastHrConflictRes = await request(app.getHttpServer())
        .patch(`/org/hr-admins/${hrId}/deactivate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(409);

      expect(lastHrConflictRes.body.code).toBe('LAST_ACTIVE_HR_ADMIN_CONFIRMATION_REQUIRED');
      expect(lastHrConflictRes.body.message).toBe('Last active HR admin, confirmation required');

      // Deactivating WITH confirmLastHr: true must succeed
      await request(app.getHttpServer())
        .patch(`/org/hr-admins/${hrId}/deactivate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ confirmLastHr: true })
        .expect(200);

      const deactivatedHr = await prisma.user.findUnique({ where: { id: hrId } });
      expect(deactivatedHr?.active).toBe(false);

      // 5. Reactivate HR Admin
      await request(app.getHttpServer())
        .patch(`/org/hr-admins/${hrId}/reactivate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const reactivatedHr = await prisma.user.findUnique({ where: { id: hrId } });
      expect(reactivatedHr?.active).toBe(true);
    });

    it('9. POST /org/transfer-ownership - validates password, checks target org, transfers cleanly', async () => {
      const { org, owner, token: ownerToken } = await createOrgWithOwner(
        'Beta Corp',
        'beta_owner@beta.com',
        'OwnerSecret123!',
      );

      const hash = await passwordService.hash('StaffPass123!');
      const newOwnerCandidate = await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'successor@beta.com',
          name: 'Successor User',
          passwordHash: hash,
          role: Role.staff,
          active: true,
        },
      });

      // Wrong current password returns 403
      await request(app.getHttpServer())
        .post('/org/transfer-ownership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          newOwnerUserId: newOwnerCandidate.id,
          currentPassword: 'WrongPassword!',
        })
        .expect(403);

      // User of another organization cannot receive ownership
      const otherOrg = await prisma.organization.create({
        data: { name: 'Other Corp' },
      });
      const outsider = await prisma.user.create({
        data: {
          orgId: otherOrg.id,
          email: 'outsider@other.com',
          name: 'Outsider',
          passwordHash: hash,
          role: Role.staff,
          active: true,
        },
      });

      await request(app.getHttpServer())
        .post('/org/transfer-ownership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          newOwnerUserId: outsider.id,
          currentPassword: 'OwnerSecret123!',
        })
        .expect(400);

      // Valid transfer
      const transferRes = await request(app.getHttpServer())
        .post('/org/transfer-ownership')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          newOwnerUserId: newOwnerCandidate.id,
          currentPassword: 'OwnerSecret123!',
        })
        .expect(200);

      expect(transferRes.body.previousOwnerId).toBe(owner.id);
      expect(transferRes.body.newOwnerId).toBe(newOwnerCandidate.id);

      // Verify in DB
      const prevOwner = await prisma.user.findUnique({ where: { id: owner.id } });
      expect(prevOwner?.role).toBe(Role.hr_admin);

      const brandNewOwner = await prisma.user.findUnique({ where: { id: newOwnerCandidate.id } });
      expect(brandNewOwner?.role).toBe(Role.org_owner);

      // Audit log created
      const audit = await prisma.auditLog.findFirst({
        where: { orgId: org.id, action: 'OWNERSHIP_TRANSFERRED' },
      });
      expect(audit).toBeDefined();
    });

    it('10. Tenant Isolation - Org A owner cannot access Org B settings, users, or audit logs', async () => {
      const { org: orgA, token: ownerAToken } = await createOrgWithOwner(
        'Org A',
        'ownerA@orga.com',
      );
      const { org: orgB } = await createOrgWithOwner('Org B', 'ownerB@orgb.com');

      // Create HR admin in Org B
      const hash = await passwordService.hash('Pass123!');
      const hrB = await prisma.user.create({
        data: {
          orgId: orgB.id,
          email: 'hrB@orgb.com',
          name: 'HR in Org B',
          passwordHash: hash,
          role: Role.hr_admin,
          active: true,
        },
      });

      // Owner A attempting to demote HR in Org B returns 404 (user not found in Org A)
      await request(app.getHttpServer())
        .post(`/org/hr-admins/${hrB.id}/demote`)
        .set('Authorization', `Bearer ${ownerAToken}`)
        .send({ newRole: Role.staff })
        .expect(404);

      // Owner A reading audit logs only sees logs for Org A
      const auditLogsRes = await request(app.getHttpServer())
        .get('/org/audit-logs')
        .set('Authorization', `Bearer ${ownerAToken}`)
        .expect(200);

      const logsFromOtherOrg = auditLogsRes.body.items.filter(
        (log: any) => log.orgId !== orgA.id,
      );
      expect(logsFromOtherOrg.length).toBe(0);
    });

    it('11. Role guards - Staff or HR Admin token returns 403 on /org owner routes', async () => {
      const { org } = await createOrgWithOwner();

      const hash = await passwordService.hash('Pass123!');
      await prisma.user.create({
        data: {
          orgId: org.id,
          email: 'staff@test.com',
          name: 'Staff User',
          passwordHash: hash,
          role: Role.staff,
          active: true,
          mustChangePassword: false,
        },
      });

      const staffLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'staff@test.com', password: 'Pass123!' });

      await request(app.getHttpServer())
        .get('/org/settings')
        .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .patch('/org/settings')
        .set('Authorization', `Bearer ${staffLogin.body.accessToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });
  });
});
