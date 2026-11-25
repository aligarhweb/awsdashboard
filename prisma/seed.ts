import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { ensureDefaultRulesAndTemplates, ensureDefaultSettings, seedDemoData } from '../server/lib/demoSeed';

const prisma = new PrismaClient();

async function main() {
  await ensureDefaultSettings(prisma);
  await ensureDefaultRulesAndTemplates(prisma);

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  const adminName = process.env.ADMIN_NAME?.trim() || 'Aligarh Web Solutions';

  if (adminEmail && adminPassword) {
    const existingUsers = await prisma.user.count();
    if (existingUsers === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await prisma.user.create({
        data: {
          email: adminEmail,
          name: adminName,
          passwordHash,
        },
      });
      console.log(`Created owner account for ${adminEmail}`);
    } else {
      console.log('Owner account already exists; skipping admin creation.');
    }
  } else {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set; use the first-run web setup screen to create your owner account.');
  }

  const demoResult = await seedDemoData(prisma);
  console.log('Seed complete:', demoResult);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
