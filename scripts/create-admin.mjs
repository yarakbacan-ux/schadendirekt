import { randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const [emailArg, password] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
if (!email || !password || password.length < 12) {
  console.error('Usage: npm run user:create-admin -- admin@example.com "minimum-12-char-password"');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
const passwordHash = `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
const db = new PrismaClient();

try {
  const user = await db.user.upsert({
    where: { email },
    update: { passwordHash, role: 'ADMIN', active: true },
    create: { email, passwordHash, role: 'ADMIN', active: true }
  });
  console.log(`Admin user ready: ${user.email}`);
} finally {
  await db.$disconnect();
}
