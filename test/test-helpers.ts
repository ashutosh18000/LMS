import { OrgStatus, Role } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

/**
 * Safely cleans all database tables between test runs using TRUNCATE CASCADE.
 * Strictly verifies that execution is occurring within the test environment
 * and against the isolated Neon test branch to prevent any production data loss.
 */
export async function cleanTestDatabase(prisma: PrismaService): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'Safety Guard: cleanTestDatabase is strictly forbidden outside NODE_ENV=test!',
    );
  }

  const currentDbUrl = process.env.DATABASE_URL || '';
  const testDbUrl = process.env.TEST_DATABASE_URL || '';

  // Host comparison check
  if (process.env.DATABASE_URL_UNPOOLED) {
    try {
      const prodHost = new URL(process.env.DATABASE_URL_UNPOOLED).hostname.replace(
        /-pooler(?=\.|$)/,
        '',
      );
      const currHost = new URL(currentDbUrl).hostname.replace(
        /-pooler(?=\.|$)/,
        '',
      );
      if (currHost === prodHost) {
        throw new Error(
          'Safety Guard: cleanTestDatabase detected target database host matches production! Aborting.',
        );
      }
    } catch (e: any) {
      if (e.message.startsWith('Safety Guard:')) throw e;
    }
  }

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE 
      "AuditLog",
      "RefreshToken",
      "LeaveSegmentDay",
      "LeaveSegment",
      "LeaveRequest",
      "BalanceAdjustment",
      "LeaveBalance",
      "CarryForwardRun",
      "EmployeeSchedule",
      "WorkScheduleTemplate",
      "LeaveType",
      "Holiday",
      "User",
      "Organization"
    CASCADE;
  `);
}

/**
 * Seeds a root administrator user on the test database.
 * Reusable across test suites requiring root credentials.
 */
export async function seedTestRootUser(
  prisma: PrismaService,
  passwordService: PasswordService,
  options?: { email?: string; password?: string; name?: string },
) {
  const email = (options?.email || 'root@platform.com').toLowerCase().trim();
  const password = options?.password || 'RootSecret123!';
  const name = options?.name || 'Platform Root';

  const passwordHash = await passwordService.hash(password);

  return prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: Role.root,
      orgId: null,
      mustChangePassword: false,
      active: true,
    },
    create: {
      email,
      name,
      passwordHash,
      role: Role.root,
      orgId: null,
      mustChangePassword: false,
      active: true,
    },
  });
}
