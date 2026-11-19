import { PrismaClient, Role, SaturdayMode, OrgStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('❌ ERROR: Demo seed script cannot be executed in production environment!');
  process.exit(1);
}

const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({
  datasources: directUrl ? { db: { url: directUrl } } : undefined,
});

export const DEMO_PASSWORD = 'DemoPassword123!';

async function seedDemoData() {
  console.log('--- STARTING DEMO DATA SEEDING ---');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // 1. Demo Organization: Acme Technologies
  console.log('1. Upserting Demo Organization: Acme Technologies...');
  let org = await prisma.organization.findFirst({
    where: { name: 'Acme Technologies' },
  });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Acme Technologies',
        status: OrgStatus.active,
        timezone: 'Asia/Kolkata',
        financialYearStartMonth: 4, // April - March financial year
        workingDays: [1, 2, 3, 4, 5], // Monday - Friday default
        backdateAllowedDays: 7,
      },
    });
  }
  console.log(`✓ Organization ready (ID: ${org.id})`);

  // 2. Demo Users
  console.log('2. Upserting Demo Users...');
  const usersToSeed = [
    {
      email: 'owner@acme.com',
      name: 'Alice Owner',
      role: Role.org_owner,
      department: 'Executive',
      managerId: null,
    },
    {
      email: 'hr@acme.com',
      name: 'Harry HR Admin',
      role: Role.hr_admin,
      department: 'Human Resources',
      managerId: null,
    },
    {
      email: 'manager1@acme.com',
      name: 'Maya Engineering Manager',
      role: Role.manager,
      department: 'Engineering',
      managerId: null,
    },
    {
      email: 'manager2@acme.com',
      name: 'Mohan Design Manager',
      role: Role.manager,
      department: 'Design & Support',
      managerId: null,
    },
  ];

  const userMap = new Map<string, any>();

  for (const u of usersToSeed) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        department: u.department,
        active: true,
        mustChangePassword: false,
        passwordHash,
      },
      create: {
        orgId: org.id,
        email: u.email,
        name: u.name,
        role: u.role,
        department: u.department,
        active: true,
        mustChangePassword: false,
        passwordHash,
      },
    });
    userMap.set(u.email, user);
  }

  const manager1 = userMap.get('manager1@acme.com');
  const manager2 = userMap.get('manager2@acme.com');

  const staffToSeed = [
    {
      email: 'staff1@acme.com',
      name: 'Sam Staff (Standard 5-day)',
      role: Role.staff,
      department: 'Engineering',
      managerId: manager1.id,
    },
    {
      email: 'staff2@acme.com',
      name: 'Sara Staff (Saturday Half-Day)',
      role: Role.staff,
      department: 'Engineering',
      managerId: manager1.id,
    },
    {
      email: 'staff3@acme.com',
      name: 'Steve Staff (Alternate 1st & 3rd Off)',
      role: Role.staff,
      department: 'Engineering',
      managerId: manager1.id,
    },
    {
      email: 'staff4@acme.com',
      name: 'Sonia Staff (Alternate 2nd & 4th Off)',
      role: Role.staff,
      department: 'Design & Support',
      managerId: manager2.id,
    },
    {
      email: 'staff5@acme.com',
      name: 'Sean Staff (Org Default 5-day)',
      role: Role.staff,
      department: 'Design & Support',
      managerId: manager2.id,
    },
  ];

  for (const u of staffToSeed) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        department: u.department,
        managerId: u.managerId,
        active: true,
        mustChangePassword: false,
        passwordHash,
      },
      create: {
        orgId: org.id,
        email: u.email,
        name: u.name,
        role: u.role,
        department: u.department,
        managerId: u.managerId,
        active: true,
        mustChangePassword: false,
        passwordHash,
      },
    });
    userMap.set(u.email, user);
  }
  console.log(`✓ 9 Demo Users upserted (Owner, HR, 2 Managers, 5 Staff)`);

  // 3. Schedule Templates
  console.log('3. Upserting Schedule Templates...');
  const templatesToSeed = [
    {
      name: 'Standard 5-day (Mon-Fri)',
      saturdayMode: SaturdayMode.off,
      alternateOffWeeks: [],
    },
    {
      name: 'Saturday Half-Day Shift',
      saturdayMode: SaturdayMode.half,
      alternateOffWeeks: [],
    },
    {
      name: 'Alternate Saturdays (1st & 3rd Off)',
      saturdayMode: SaturdayMode.alternate,
      alternateOffWeeks: [1, 3],
    },
    {
      name: 'Alternate Saturdays (2nd & 4th Off)',
      saturdayMode: SaturdayMode.alternate,
      alternateOffWeeks: [2, 4],
    },
  ];

  const templateMap = new Map<string, any>();
  for (const t of templatesToSeed) {
    const tpl = await prisma.workScheduleTemplate.upsert({
      where: {
        orgId_name: {
          orgId: org.id,
          name: t.name,
        },
      },
      update: {
        saturdayMode: t.saturdayMode,
        alternateOffWeeks: t.alternateOffWeeks,
        active: true,
      },
      create: {
        orgId: org.id,
        name: t.name,
        saturdayMode: t.saturdayMode,
        alternateOffWeeks: t.alternateOffWeeks,
        active: true,
      },
    });
    templateMap.set(t.name, tpl);
  }
  console.log(`✓ 4 Schedule Templates upserted`);

  // 4. Assign Employee Schedules (Showcase Saturday Availability)
  console.log('4. Assigning Work Schedules to Staff & Managers...');
  const effectiveDate = new Date('2026-01-01T00:00:00.000Z');
  const hrUser = userMap.get('hr@acme.com');

  const assignments = [
    { userEmail: 'manager1@acme.com', templateName: 'Standard 5-day (Mon-Fri)' },
    { userEmail: 'manager2@acme.com', templateName: 'Standard 5-day (Mon-Fri)' },
    { userEmail: 'staff1@acme.com', templateName: 'Standard 5-day (Mon-Fri)' },
    { userEmail: 'staff2@acme.com', templateName: 'Saturday Half-Day Shift' },
    { userEmail: 'staff3@acme.com', templateName: 'Alternate Saturdays (1st & 3rd Off)' },
    { userEmail: 'staff4@acme.com', templateName: 'Alternate Saturdays (2nd & 4th Off)' },
    // staff5 left unassigned to demonstrate org default workingDays fallback!
  ];

  for (const a of assignments) {
    const u = userMap.get(a.userEmail);
    const t = templateMap.get(a.templateName);
    await prisma.employeeSchedule.upsert({
      where: {
        userId_effectiveFrom: {
          userId: u.id,
          effectiveFrom: effectiveDate,
        },
      },
      update: {
        templateId: t.id,
      },
      create: {
        orgId: org.id,
        userId: u.id,
        templateId: t.id,
        effectiveFrom: effectiveDate,
        createdBy: hrUser.id,
      },
    });
  }
  console.log(`✓ Work schedule assignments configured`);

  // 5. Leave Types
  console.log('5. Upserting Leave Types...');
  const leaveTypesToSeed = [
    {
      name: 'Casual Leave',
      paid: true,
      daysPerYear: new Decimal(12.0),
      monthlyLimit: null,
      deductsBalance: true,
      isWfh: false,
      halfDayAllowed: true,
      carryForwardMax: new Decimal(0),
    },
    {
      name: 'Sick Leave',
      paid: true,
      daysPerYear: new Decimal(8.0),
      monthlyLimit: null,
      deductsBalance: true,
      isWfh: false,
      halfDayAllowed: true,
      carryForwardMax: new Decimal(0),
    },
    {
      name: 'Earned Leave',
      paid: true,
      daysPerYear: new Decimal(15.0),
      monthlyLimit: null,
      deductsBalance: true,
      isWfh: false,
      halfDayAllowed: false,
      carryForwardMax: new Decimal(5.0),
    },
    {
      name: 'Work From Home',
      paid: true,
      daysPerYear: null, // Unlimited annual quota
      monthlyLimit: new Decimal(2.0), // Cap at 2 per month
      deductsBalance: false,
      isWfh: true,
      halfDayAllowed: true,
      carryForwardMax: new Decimal(0),
    },
  ];

  const leaveTypeMap = new Map<string, any>();
  for (const lt of leaveTypesToSeed) {
    const existing = await prisma.leaveType.findFirst({
      where: { orgId: org.id, name: lt.name },
    });

    if (existing) {
      const updated = await prisma.leaveType.update({
        where: { id: existing.id },
        data: lt,
      });
      leaveTypeMap.set(lt.name, updated);
    } else {
      const created = await prisma.leaveType.create({
        data: {
          orgId: org.id,
          ...lt,
        },
      });
      leaveTypeMap.set(lt.name, created);
    }
  }
  console.log(`✓ 4 Leave Types upserted (Casual, Sick, Earned, WFH)`);

  // 6. Organization Holidays
  console.log('6. Upserting Organization Holidays...');
  const holidaysToSeed = [
    { name: 'Republic Day', date: '2026-01-26' },
    { name: 'Independence Day', date: '2026-08-15' },
    { name: 'Gandhi Jayanti', date: '2026-10-02' },
    { name: 'Diwali', date: '2026-11-11' },
    { name: 'Christmas', date: '2026-12-25' },
  ];

  for (const h of holidaysToSeed) {
    const dateObj = new Date(`${h.date}T00:00:00.000Z`);
    await prisma.holiday.upsert({
      where: {
        orgId_date: {
          orgId: org.id,
          date: dateObj,
        },
      },
      update: {
        name: h.name,
        active: true,
      },
      create: {
        orgId: org.id,
        name: h.name,
        date: dateObj,
        active: true,
      },
    });
  }
  console.log(`✓ 5 Holidays upserted`);

  // 7. Balances for Current Leave Year (2026)
  console.log('7. Allocating Leave Balances for 2026...');
  const currentLeaveYear = 2026;
  const balanceLeaveTypes = ['Casual Leave', 'Sick Leave', 'Earned Leave'];
  const eligibleUsers = [
    ...usersToSeed.filter((u) => u.role !== Role.org_owner),
    ...staffToSeed,
  ];

  for (const eu of eligibleUsers) {
    const user = userMap.get(eu.email);
    for (const ltName of balanceLeaveTypes) {
      const lt = leaveTypeMap.get(ltName);
      if (!lt || !lt.daysPerYear) continue;

      await prisma.leaveBalance.upsert({
        where: {
          userId_leaveTypeId_year: {
            userId: user.id,
            leaveTypeId: lt.id,
            year: currentLeaveYear,
          },
        },
        update: {
          allocated: lt.daysPerYear,
        },
        create: {
          orgId: org.id,
          userId: user.id,
          leaveTypeId: lt.id,
          year: currentLeaveYear,
          allocated: lt.daysPerYear,
          used: new Decimal(0),
          pending: new Decimal(0),
        },
      });
    }
  }
  console.log(`✓ Balances allocated for current leave year ${currentLeaveYear}`);

  console.log('\n======================================================');
  console.log('🎉 DEMO DATA SEEDED SUCCESSFULLY!');
  console.log('Credentials (Password for all demo accounts: ' + DEMO_PASSWORD + '):');
  console.log('  - Org Owner: owner@acme.com');
  console.log('  - HR Admin: hr@acme.com');
  console.log('  - Engineering Manager: manager1@acme.com');
  console.log('  - Design Manager: manager2@acme.com');
  console.log('  - Staff 1 (Standard 5-day): staff1@acme.com');
  console.log('  - Staff 2 (Saturday Half): staff2@acme.com');
  console.log('  - Staff 3 (Alternate 1st & 3rd Off): staff3@acme.com');
  console.log('  - Staff 4 (Alternate 2nd & 4th Off): staff4@acme.com');
  console.log('  - Staff 5 (Default 5-day Fallback): staff5@acme.com');
  console.log('======================================================\n');
}

seedDemoData()
  .catch((err) => {
    console.error('Failed to seed demo data:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
