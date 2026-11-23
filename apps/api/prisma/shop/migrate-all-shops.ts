import { PrismaClient as ControlPrismaClient } from '../../src/generated/prisma-control';
import { getEnv } from '../../src/common/config/env.config';
import { runShopMigrations } from '../../src/common/database/shop-migration.runner';

async function main(): Promise<void> {
  const env = getEnv();
  const control = new ControlPrismaClient();
  await control.$connect();

  try {
    const shops = await control.shop.findMany({
      where: { status: { not: 'TERMINATED' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, dbName: true, dbStatus: true },
    });

    console.log(`[db:migrate:shops] ${shops.length} base(s) boutique(s) à vérifier/migrer.`);

    const encodedUser = encodeURIComponent(env.POSTGRES_USER);
    const encodedPass = encodeURIComponent(env.POSTGRES_PASSWORD);
    const isLocalHost =
      env.POSTGRES_HOST === 'localhost' ||
      env.POSTGRES_HOST === '127.0.0.1' ||
      env.POSTGRES_HOST === 'postgres' ||
      env.POSTGRES_HOST === 'shopcontrol_postgres' ||
      !env.POSTGRES_HOST.includes('.');
    const sslParam =
      env.DATABASE_URL.includes('sslmode=require') || (!isLocalHost && env.POSTGRES_HOST.includes('.'))
        ? '&sslmode=require'
        : '';

    for (const shop of shops) {
      const url = `postgresql://${encodedUser}:${encodedPass}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${shop.dbName}?schema=public&connection_limit=2${sslParam}`;
      try {
        const result = await runShopMigrations(url);
        await control.shop.update({
          where: { id: shop.id },
          data: {
            dbStatus: 'READY',
            dbSchemaVersion: result.latestVersion,
          },
        });
        console.log(
          `[db:migrate:shops] OK ${shop.name} (${shop.dbName}) -> ${result.latestVersion} (${result.appliedVersions.length} nouvelle(s))`,
        );
      } catch (err) {
        await control.shop.update({
          where: { id: shop.id },
          data: { dbStatus: 'MIGRATION_FAILED' },
        });
        console.error(`[db:migrate:shops] ÉCHEC ${shop.name} (${shop.dbName}) :`, err);
        process.exitCode = 1;
      }
    }
  } finally {
    await control.$disconnect();
  }
}

main().catch((err) => {
  console.error('[db:migrate:shops] Erreur fatale :', err);
  process.exit(1);
});
