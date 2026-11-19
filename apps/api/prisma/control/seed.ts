import * as crypto from 'crypto';
import * as argon2 from 'argon2';
import { PrismaClient } from '../../src/generated/prisma-control';
import '../../src/common/config/env.config';

async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
  const fullName = process.env.BOOTSTRAP_SUPER_ADMIN_NAME?.trim() || 'Super Admin ShopControl';

  if (!email || !password) {
    throw new Error(
      'Variables BOOTSTRAP_SUPER_ADMIN_EMAIL et BOOTSTRAP_SUPER_ADMIN_PASSWORD obligatoires dans .env pour le seed initial.',
    );
  }

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`[seed] Super Admin déjà présent : ${existing.email} (${existing.id})`);
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const created = await prisma.user.create({
      data: {
        role: 'SUPER_ADMIN',
        email,
        fullName,
        passwordHash,
        isActive: true,
        totpEnabled: false,
      },
    });

    const prevHash = 'GENESIS';
    const payload = JSON.stringify({
      action: 'BOOTSTRAP_SUPER_ADMIN',
      entityId: created.id,
      email: created.email,
    });
    const entryHash = crypto.createHash('sha256').update(`${prevHash}:${payload}`).digest('hex');

    await prisma.auditLog.create({
      data: {
        actorUserId: created.id,
        actorRole: 'SUPER_ADMIN',
        action: 'BOOTSTRAP_SUPER_ADMIN',
        entityType: 'User',
        entityId: created.id,
        afterData: { email: created.email, role: created.role },
        reason: 'Initialisation initiale de la plateforme ShopControl',
        prevHash,
        entryHash,
      },
    });

    console.log(`[seed] Super Admin créé avec succès : ${created.email} (${created.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] Erreur :', err);
  process.exit(1);
});
