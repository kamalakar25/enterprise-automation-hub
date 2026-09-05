import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Default admin user ──
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@company.com' },
    update: {},
    create: {
      email: 'admin@company.com',
      username: 'admin',
      fullName: 'Platform Administrator',
      passwordHash: adminPassword,
      role: 'ADMIN',
      department: 'IT',
    },
  });
  console.log('   Admin user: admin@company.com / admin123');

  // ── Demo operator ──
  const opPass = await bcrypt.hash('operator123', 10);
  await prisma.user.upsert({
    where: { email: 'operator@company.com' },
    update: {},
    create: {
      email: 'operator@company.com',
      username: 'operator',
      fullName: 'Operations User',
      passwordHash: opPass,
      role: 'OPERATOR',
      department: 'Procurement',
    },
  });
  console.log('   Operator user: operator@company.com / operator123');

  // ── Default automation modules (from blueprint) ──
  const modules = [
    {
      slug: 'sap-daily-tracker',
      name: 'SAP Daily Tracker',
      description: 'Full pipeline: SAP snapshot → reconcile → validate → VBS SAP GUI update → apply status → RUN_REPORT.xlsx. Requires PERNR + CUMMODE. Runs on the Windows SAP worker.',
      executionType: 'WINDOWS_VBS',
      allowedRoles: ['ADMIN', 'MANAGER', 'OPERATOR'],
      icon: '📊',
    },
    {
      slug: 'zprs-pending-tracker',
      name: 'ZPRS Pending Tracker',
      description: 'Track ZPRS pending items and priority status, push updates to SAP via Windows worker.',
      executionType: 'WINDOWS_VBS',
      allowedRoles: ['ADMIN', 'MANAGER', 'OPERATOR'],
      icon: '⏳',
    },
    {
      slug: 'me2m-analyzer',
      name: 'SAP ME2M Procurement Analyzer',
      description: '90-day horizon procurement & schedule analysis from raw ME2M CSV/XLSX export.',
      executionType: 'PYTHON_HEADLESS',
      allowedRoles: ['ADMIN', 'MANAGER', 'OPERATOR'],
      icon: '📈',
      scriptPath: 'src/workers/scripts/python/me2m-analyzer.py',
    },
    {
      slug: 'vendor-email',
      name: 'Bulk Vendor Email Dispatcher',
      description: 'Automated follow-up emails to vendors via SMTP using customizable subject + body templates with placeholders.',
      executionType: 'PYTHON_HEADLESS',
      allowedRoles: ['ADMIN', 'MANAGER'],
      icon: '📧',
      scriptPath: 'src/workers/scripts/python/vendor-email.py',
    },
  ];

  for (const m of modules) {
    await prisma.automationModule.upsert({
      where: { slug: m.slug },
      update: m,
      create: m,
    });
  }
  console.log(`   Seeded ${modules.length} automation modules`);

  console.log('✅ Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
