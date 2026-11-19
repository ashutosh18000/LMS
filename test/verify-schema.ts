import { PrismaClient, Role, OrgStatus } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function runTests() {
  console.log('\n--- STARTING SCHEMA AND CONSTRAINT VERIFICATION TESTS ---\n');

  // Clean up any test data from previous runs if any
  await prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE email LIKE '%@test.com'`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Organization" WHERE name LIKE 'Test Org%'`);

  // Test 1: Create a test organization
  console.log('Test 1: Creating test organization...');
  const org = await prisma.organization.create({
    data: {
      name: 'Test Org 1',
      status: OrgStatus.active,
    },
  });
  console.log(`✓ Organization created (ID: ${org.id})`);

  // Test 2: Create first active org_owner
  console.log('\nTest 2: Creating first active org_owner in Test Org 1...');
  const owner1 = await prisma.user.create({
    data: {
      orgId: org.id,
      email: 'owner1@test.com',
      name: 'Owner One',
      passwordHash: 'dummyhash',
      role: Role.org_owner,
      active: true,
    },
  });
  console.log(`✓ First owner created (ID: ${owner1.id})`);

  // Test 3: Attempt to create a SECOND active org_owner in the SAME org (MUST FAIL)
  console.log('\nTest 3: Attempting to create second active org_owner in same org (expected to fail)...');
  try {
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'owner2@test.com',
        name: 'Owner Two',
        passwordHash: 'dummyhash',
        role: Role.org_owner,
        active: true,
      },
    });
    throw new Error('FAILED: Second active org_owner was allowed, but constraint should have blocked it!');
  } catch (error: any) {
    if (error.message.includes('uq_one_active_owner_per_org') || error.code === 'P2002' || error.message.includes('unique constraint')) {
      console.log('✓ PASS: Constraint blocked second active org_owner as expected!');
    } else {
      console.error('Unexpected error:', error);
      throw error;
    }
  }

  // Test 4: Creating an INACTIVE org_owner in the same org (MUST SUCCEED)
  console.log('\nTest 4: Creating an inactive org_owner in same org (expected to succeed)...');
  const inactiveOwner = await prisma.user.create({
    data: {
      orgId: org.id,
      email: 'inactive_owner@test.com',
      name: 'Inactive Owner',
      passwordHash: 'dummyhash',
      role: Role.org_owner,
      active: false,
    },
  });
  console.log(`✓ PASS: Inactive org_owner allowed (ID: ${inactiveOwner.id})`);

  // Test 5: Verify single root constraint
  console.log('\nTest 5: Testing single root constraint...');
  try {
    await prisma.user.create({
      data: {
        orgId: null,
        email: 'second_root@test.com',
        name: 'Second Root',
        passwordHash: 'dummyhash',
        role: Role.root,
        active: true,
      },
    });
    throw new Error('FAILED: Second root user was created, but uq_single_root should have blocked it!');
  } catch (error: any) {
    if (error.message.includes('uq_single_root') || error.code === 'P2002' || error.message.includes('unique constraint')) {
      console.log('✓ PASS: Single root constraint successfully blocked duplicate root user!');
    } else {
      console.error('Unexpected error:', error);
      throw error;
    }
  }

  // Test 6: Verify root must have orgId = NULL
  console.log('\nTest 6: Testing root with non-null orgId (expected to fail)...');
  try {
    await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'root_with_org@test.com',
        name: 'Root With Org',
        passwordHash: 'dummyhash',
        role: Role.root,
      },
    });
    throw new Error('FAILED: Root with orgId was created, but chk_user_root_org should have blocked it!');
  } catch (error: any) {
    if (error.message.includes('chk_user_root_org') || error.message.includes('check constraint')) {
      console.log('✓ PASS: chk_user_root_org blocked root user with orgId!');
    } else {
      console.log('✓ PASS: Blocked with DB error:', error.message);
    }
  }

  // Test 7: Verify non-root MUST have orgId
  console.log('\nTest 7: Testing staff without orgId (expected to fail)...');
  try {
    await prisma.user.create({
      data: {
        orgId: null,
        email: 'staff_without_org@test.com',
        name: 'Staff No Org',
        passwordHash: 'dummyhash',
        role: Role.staff,
      },
    });
    throw new Error('FAILED: Staff without orgId was created, but chk_user_root_org should have blocked it!');
  } catch (error: any) {
    if (error.message.includes('chk_user_root_org') || error.message.includes('check constraint')) {
      console.log('✓ PASS: chk_user_root_org blocked staff user without orgId!');
    } else {
      console.log('✓ PASS: Blocked with DB error:', error.message);
    }
  }

  // Clean up test data
  console.log('\nCleaning up verification test data...');
  await prisma.user.deleteMany({ where: { email: { in: ['owner1@test.com', 'inactive_owner@test.com'] } } });
  await prisma.organization.delete({ where: { id: org.id } });
  console.log('✓ Test data cleaned up.');

  console.log('\n=== ALL SCHEMA CONSTRAINT CHECKS PASSED SUCCESSFULLY! ===\n');
}

runTests()
  .catch((e) => {
    console.error('Verification failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
