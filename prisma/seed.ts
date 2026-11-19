import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

// Ensure seed uses DIRECT_URL for unpooled direct connection to Neon/Postgres
const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

const prisma = new PrismaClient({
  datasources: directUrl
    ? {
        db: {
          url: directUrl,
        },
      }
    : undefined,
});

async function main() {
  const rootEmail = (process.env.ROOT_EMAIL || 'root@example.com')
    .trim()
    .toLowerCase();
  const rootName = (process.env.ROOT_NAME || 'Root Administrator').trim();
  const rootPassword =
    process.env.ROOT_PASSWORD || 'ChangeMeSuperSecret123!';

  console.log(`Starting database seed using DIRECT_URL connection...`);
  console.log(`Target root user: ${rootEmail}`);

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash(rootPassword, saltRounds);

  // Idempotent upsert of the root user
  const rootUser = await prisma.user.upsert({
    where: { email: rootEmail },
    update: {
      name: rootName,
      role: Role.root,
      orgId: null,
      passwordHash,
      mustChangePassword: true,
      active: true,
    },
    create: {
      email: rootEmail,
      name: rootName,
      role: Role.root,
      orgId: null,
      passwordHash,
      mustChangePassword: true,
      active: true,
    },
  });

  console.log(`✓ Root user successfully seeded/updated (ID: ${rootUser.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Error while seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
